import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Alert, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import RichEditor, {
  type EditorCommand,
  type EditorHeader,
  type EditorRequests,
  type EditorSelection,
} from "@/components/editor/rich-editor";
import { useColors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { imageSources } from "@/lib/editor/render-html";
import { CannotSave, SaveConflict, sameContent, saveDocument } from "@/lib/editor/save";
import { isNetworkError } from "@/lib/outline/api";
import { getDocument, resolveAttachmentUrl, type OutlineDocument, type PMNode } from "@/lib/outline/documents";
import { EditConflictError } from "@/lib/outline/edits";
import { useTextScale } from "@/lib/text-size";

// A document shown in the editor: it reads like a page until tapped, and
// changes save themselves a moment after typing stops, like Outline's own
// editor. Saving is described in lib/editor/save.ts.

// Expo sends every prop to the web view again, the whole document included,
// whenever the component renders; memo keeps that to real changes.
const Editor = memo(RichEditor);
const EDITOR_DOM = { style: { flex: 1 }, containerStyle: { flex: 1 } };

/** How long typing has to pause before a save. */
const SAVE_DELAY_MS = 1200;
/** Saves happen at least this often while typing goes on. */
const MAX_UNSAVED_MS = 8000;
/** How soon to try again while offline. */
const RETRY_MS = 8000;

const TOOLS: { command: EditorCommand; label: string; active?: string }[] = [
  { command: "undo", label: "↶" },
  { command: "redo", label: "↷" },
  { command: "bold", label: "B", active: "strong" },
  { command: "italic", label: "I", active: "em" },
  { command: "strike", label: "S", active: "strikethrough" },
  { command: "code", label: "</>", active: "code_inline" },
  { command: "heading1", label: "H1", active: "heading1" },
  { command: "heading2", label: "H2", active: "heading2" },
  { command: "paragraph", label: "¶" },
  { command: "bulletList", label: "•", active: "bullet_list" },
  { command: "orderedList", label: "1.", active: "ordered_list" },
  { command: "checkList", label: "☑", active: "checkbox_list" },
  { command: "quote", label: "❝", active: "blockquote" },
  { command: "outdent", label: "⇤" },
  { command: "indent", label: "⇥" },
];

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "note"; message: string }
  | { kind: "offline" }
  /** Saving stopped until the next change; `reload` offers to start over from the server's copy. */
  | { kind: "error"; message: string; reload?: boolean };

export interface DocumentEditorHandle {
  scrollToBlock: (block: number) => void;
}

export function DocumentEditor({
  document,
  header,
  above,
  onSaved,
  onUnsupported,
  onOpenLink,
  onOpenDocument,
  ref,
}: {
  /** The latest copy of the document; the editor starts from the first. */
  document: OutlineDocument;
  header: EditorHeader;
  /** Shown above the page, e.g. the rename field or an offline note. */
  above?: ReactNode;
  onSaved: (document: OutlineDocument) => void;
  /** The document can't be edited exactly; the reader should show it instead. */
  onUnsupported: () => void;
  onOpenLink: (href: string) => void;
  onOpenDocument: (documentId: string) => void;
  ref?: Ref<DocumentEditorHandle>;
}) {
  const colors = useColors();
  const scale = useTextScale();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { requestWithPolicies, session } = useAuth();

  // What the editor started from (a new one remounts it), and what the next
  // save is compared with.
  const [opened, setOpened] = useState({ content: document.data, generation: 0 });
  const [base, setBase] = useState<PMNode>(document.data);
  const [changes, setChanges] = useState(0);
  const [savedChanges, setSavedChanges] = useState(0);
  // A save that failed for good waits for the next change.
  const [failedAt, setFailedAt] = useState<number | null>(null);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [images, setImages] = useState<Record<string, string>>({});
  const firstUnsavedAt = useRef<number | null>(null);
  const leaveAction = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  // Requests to the editor, each with a new number (see rich-editor.tsx).
  const [command, setCommand] = useState<EditorRequests["command"]>(null);
  const [saveRequest, setSaveRequest] = useState(0);
  const [scrollTo, setScrollTo] = useState<EditorRequests["scrollTo"]>(null);
  const [blurRequest, setBlurRequest] = useState(0);
  const requests = useMemo<EditorRequests>(
    () => ({ command, save: saveRequest, scrollTo, blur: blurRequest }),
    [command, saveRequest, scrollTo, blurRequest],
  );
  const run = useCallback(
    (name: EditorCommand) => setCommand((current) => ({ name, seq: (current?.seq ?? 0) + 1 })),
    [],
  );
  const requestSave = useCallback(() => setSaveRequest((current) => current + 1), []);
  // The document is sent until the editor has it; after that it would only
  // go to the web view again with every other prop change.
  const [readyGeneration, setReadyGeneration] = useState(-1);
  // Read when saving, so onSave keeps its identity (a new one would resend all props).
  const baseRef = useRef(base);
  useEffect(() => {
    baseRef.current = base;
  }, [base]);

  const unsaved = changes > savedChanges;

  useImperativeHandle(
    ref,
    () => ({ scrollToBlock: (block) => setScrollTo((current) => ({ block, seq: (current?.seq ?? 0) + 1 })) }),
    [],
  );

  // A newer copy from the server is shown as long as nothing was typed yet.
  const [seenDocument, setSeenDocument] = useState(document);
  if (document !== seenDocument) {
    setSeenDocument(document);
    if (changes === 0 && !focused && !sameContent(document.data, opened.content)) {
      setOpened({ content: document.data, generation: opened.generation + 1 });
      setBase(document.data);
    }
  }

  // Images from the server need the token; the web view gets signed URLs.
  useEffect(() => {
    if (!session) {
      return;
    }
    let current = true;
    const sources = [...imageSources(opened.content)].filter((src) => src.includes("/api/attachments.redirect"));
    void Promise.all(
      sources.map(async (src) => {
        try {
          return [src, await resolveAttachmentUrl(src, session.server, session.accessToken)] as const;
        } catch {
          return null;
        }
      }),
    ).then((resolved) => {
      if (current) {
        setImages(Object.fromEntries(resolved.filter((entry) => entry !== null)));
      }
    });
    return () => {
      current = false;
    };
    // The token renews hourly; signed URLs already made keep working.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened.content, session?.server]);

  const onSave = useCallback(
    async (edited: PMNode, count: number) => {
      setSaving(true);
      setStatus({ kind: "saving" });
      try {
        const result = await saveDocument(requestWithPolicies, document.id, baseRef.current, edited);
        baseRef.current = result.base;
        setBase(result.base);
        setSavedChanges(count);
        setFailedAt(null);
        firstUnsavedAt.current = null;
        onSaved(result.document);
        const notes = [
          result.matches ? null : "Outline stored this a little differently; check it on the web.",
          result.mergedChangesElsewhere ? "Changes made elsewhere were kept; they show next time you open this." : null,
          result.lostComments > 0
            ? `${result.lostComments === 1 ? "A comment's highlight was" : `${result.lostComments} comments' highlights were`} removed with the text under it.`
            : null,
        ].filter((note) => note !== null);
        setStatus(notes.length ? { kind: "note", message: notes.join(" ") } : { kind: "idle" });
      } catch (err) {
        if (isNetworkError(err)) {
          setStatus({ kind: "offline" });
          setTimeout(() => setRetry((value) => value + 1), RETRY_MS);
        } else if (err instanceof EditConflictError) {
          // Changed while saving: try again on the newer copy.
          setTimeout(() => setRetry((value) => value + 1), 500);
        } else {
          setFailedAt(count);
          setStatus({
            kind: "error",
            message:
              err instanceof CannotSave || err instanceof SaveConflict
                ? err.message
                : `Not saved: ${err instanceof Error ? err.message : "something went wrong"}`,
            reload: err instanceof SaveConflict,
          });
        }
        if (leaveAction.current) {
          const action = leaveAction.current;
          leaveAction.current = null;
          Alert.alert("Leave without saving?", "Your latest changes couldn't be saved.", [
            { text: "Keep editing", style: "cancel" },
            { text: "Leave", style: "destructive", onPress: () => navigation.dispatch(action) },
          ]);
        }
      } finally {
        setSaving(false);
      }
    },
    [document.id, navigation, onSaved, requestWithPolicies],
  );

  // Saves a moment after typing stops, and at least every few seconds.
  useEffect(() => {
    if (!unsaved || saving || (failedAt !== null && changes <= failedAt)) {
      return;
    }
    firstUnsavedAt.current ??= Date.now();
    const waited = Date.now() - firstUnsavedAt.current;
    const timer = setTimeout(() => requestSave(), Math.max(0, Math.min(SAVE_DELAY_MS, MAX_UNSAVED_MS - waited)));
    return () => clearTimeout(timer);
  }, [changes, unsaved, saving, failedAt, retry, requestSave]);

  // Going to the background saves at once.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" && unsaved && !saving) {
        requestSave();
      }
    });
    return () => subscription.remove();
  }, [unsaved, saving, requestSave]);

  // Leaving saves first, then goes.
  usePreventRemove(unsaved || saving, ({ data }) => {
    leaveAction.current = data.action;
    if (!saving) {
      requestSave();
    }
  });
  useEffect(() => {
    if (leaveAction.current && !unsaved && !saving) {
      const action = leaveAction.current;
      leaveAction.current = null;
      navigation.dispatch(action);
    }
  }, [unsaved, saving, navigation]);

  async function reloadFromServer() {
    try {
      const fresh = await getDocument(requestWithPolicies, document.id);
      onSaved(fresh);
      setOpened((current) => ({ content: fresh.data, generation: current.generation + 1 }));
      setBase(fresh.data);
      setChanges(0);
      setSavedChanges(0);
      setFailedAt(null);
      setStatus({ kind: "idle" });
    } catch {
      Alert.alert("Couldn't reload", "Can't reach the server. Try again when you're online.");
    }
  }

  const onReady = useCallback(
    async (report: { roundTrip: boolean; error: string | null }) => {
      if (report.error || !report.roundTrip) {
        onUnsupported();
        return;
      }
      setReadyGeneration(opened.generation);
    },
    [onUnsupported, opened.generation],
  );
  const onChange = useCallback(async (count: number) => setChanges(count), []);
  const onSelection = useCallback(async (value: EditorSelection) => setSelection(value), []);
  const onFocusChange = useCallback(async (value: boolean) => setFocused(value), []);
  const openLink = useCallback(async (href: string) => onOpenLink(href), [onOpenLink]);
  const openDocument = useCallback(async (id: string) => onOpenDocument(id), [onOpenDocument]);

  // The toolbar sits on the keyboard, following it frame by frame.
  const keyboard = useReanimatedKeyboardAnimation();
  const editingStyle = useAnimatedStyle(() => ({ paddingBottom: -keyboard.height.value }));
  const toolbarStyle = useAnimatedStyle(() => ({ paddingBottom: insets.bottom * (1 - keyboard.progress.value) }));

  const active = new Set(selection?.active ?? []);
  const statusText =
    status.kind === "saving"
      ? "Saving…"
      : status.kind === "offline"
        ? "Offline. Your changes will be saved when you're back online."
        : status.kind === "note" || status.kind === "error"
          ? status.message
          : null;

  // A note goes away after a while; errors stay until something changes.
  useEffect(() => {
    if (status.kind !== "note") {
      return;
    }
    const timer = setTimeout(() => setStatus({ kind: "idle" }), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <Animated.View style={[styles.container, editingStyle]}>
      {above}
      {statusText ? (
        <View style={[styles.status, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.statusText, { color: status.kind === "error" ? colors.danger : colors.muted }]}>
            {statusText}
          </Text>
          {status.kind === "error" && status.reload ? (
            <Pressable accessibilityRole="button" onPress={reloadFromServer} hitSlop={8}>
              <Text style={[styles.statusAction, { color: colors.primary }]}>Reload</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <View style={styles.container}>
        <Editor
          key={opened.generation}
          content={readyGeneration === opened.generation ? undefined : opened.content}
          requests={requests}
          header={header}
          images={images}
          colors={colors}
          fontSize={16 * scale}
          onReady={onReady}
          onChange={onChange}
          onSave={onSave}
          onSelection={onSelection}
          onFocusChange={onFocusChange}
          onOpenLink={openLink}
          onOpenDocument={openDocument}
          dom={EDITOR_DOM}
        />
      </View>
      {focused ? (
        <Animated.View style={[styles.toolbar, { borderColor: colors.border, backgroundColor: colors.surface }, toolbarStyle]}>
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.toolbarContent}
          >
            {TOOLS.map((tool) => {
              const on = tool.active !== undefined && active.has(tool.active);
              const disabled =
                (tool.command === "undo" && !selection?.canUndo) || (tool.command === "redo" && !selection?.canRedo);
              return (
                <Pressable
                  key={tool.command}
                  accessibilityRole="button"
                  accessibilityLabel={tool.command}
                  accessibilityState={{ selected: on, disabled }}
                  disabled={disabled}
                  onPress={() => run(tool.command)}
                  style={({ pressed }) => [
                    styles.tool,
                    on && { backgroundColor: colors.primary },
                    (pressed || disabled) && { opacity: 0.4 },
                  ]}
                >
                  <Text style={[styles.toolLabel, { color: on ? colors.onPrimary : colors.text }]}>{tool.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Done editing"
            onPress={() => setBlurRequest((current) => current + 1)}
            style={({ pressed }) => [styles.done, { borderColor: colors.border }, pressed && { opacity: 0.4 }]}
          >
            <Text style={[styles.doneLabel, { color: colors.primary }]}>Done</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statusText: {
    flex: 1,
    fontSize: 12,
  },
  statusAction: {
    fontSize: 13,
    fontWeight: "600",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toolbarContent: {
    padding: 6,
    gap: 2,
  },
  tool: {
    minWidth: 40,
    height: 38,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  toolLabel: {
    fontSize: 17,
    fontWeight: "600",
  },
  done: {
    height: 38,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  doneLabel: {
    fontSize: 15,
    fontWeight: "600",
  },
});
