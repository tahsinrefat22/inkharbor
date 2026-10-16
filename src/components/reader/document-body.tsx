import { Image } from "expo-image";
import {
  createContext,
  useContext,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type FlatList,
  type PanResponderInstance,
  type RefreshControlProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useScrollThumb } from "@/components/reader/scroll-thumb";
import type { Colors } from "@/constants/colors";
import emojiNames from "@/lib/emoji-names.json";
import { useTextScale } from "@/lib/text-size";
import type { PMNode } from "@/lib/outline/documents";

// Renders Outline's ProseMirror JSON with native components. Every node and
// mark type in Outline's editor (shared/editor/nodes and marks) is handled;
// unknown types render their children so text is never silently dropped.

export interface ReaderContextValue {
  server: string;
  colors: Colors;
  /** Opens a link: documents in the app, files via signed URLs, the rest in a browser. */
  openLink: (href: string) => void;
  openDocument: (id: string) => void;
}

/** What reader components share: the props above, plus the text size setting. */
type ReaderContextState = ReaderContextValue & {
  /** Multiplies every text size (and table cell width); 1 is the default. */
  scale: number;
};

const ReaderContext = createContext<ReaderContextState | null>(null);

/**
 * The access token, kept out of ReaderContext: it's renewed every hour, and
 * only images use it, so a renewal shouldn't redraw the whole document.
 */
const AccessTokenContext = createContext("");

/**
 * The token for an image's request, fixed when the image first appears so a
 * renewal doesn't make it load again. Images that appear later get the
 * current token.
 */
function useImageToken(): string {
  const accessToken = useContext(AccessTokenContext);
  const [token] = useState(accessToken);
  return token;
}

/** True inside table header cells, whose text is bold. */
const HeaderCellContext = createContext(false);

function useReader(): ReaderContextState {
  const value = useContext(ReaderContext);
  if (!value) {
    throw new Error("Reader components must be inside ReaderProvider");
  }
  return value;
}

// Bundled with the app (loaded in the root layout) so code stays fixed-width
// even on phones whose font theme replaces the system monospace font.
export const CODE_FONT = "JetBrainsMono_400Regular";

function attr(node: PMNode, name: string): unknown {
  return node.attrs?.[name];
}

function stringAttr(node: PMNode, name: string): string | undefined {
  const value = attr(node, name);
  return typeof value === "string" && value ? value : undefined;
}

function numberAttr(node: PMNode, name: string): number | undefined {
  const value = Number(attr(node, name));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All text inside a node, e.g. for code blocks and maths. */
function plainText(node: PMNode): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  if (node.type === "br") {
    return "\n";
  }
  return (node.content ?? []).map(plainText).join("");
}

/** A heading at the top level of a document, for its table of contents. */
export interface DocumentHeading {
  /** The heading's position among the document's top-level blocks. */
  block: number;
  level: number;
  title: string;
}

/**
 * The document's headings, in order. Headings inside toggles, notices and
 * other blocks are left out: they can't be jumped to while folded away.
 */
export function documentHeadings(blocks: PMNode[]): DocumentHeading[] {
  return blocks.flatMap((node, block) => {
    if (node.type !== "heading") {
      return [];
    }
    const title = plainText(node).trim();
    return title ? [{ block, level: numberAttr(node, "level") ?? 1, title }] : [];
  });
}

export interface DocumentListHandle {
  /** Jumps to a top-level block, e.g. a heading from documentHeadings(). */
  scrollToBlock: (block: number) => void;
}

/** Space left above a heading the reader jumped to. */
const JUMP_MARGIN = 8;
/** Tries to reach a block that isn't drawn yet before giving up. */
const JUMP_ATTEMPTS = 5;

/**
 * Shares the server, colours and link handling with reader components
 * outside DocumentList, e.g. ReaderBlocks in a comment.
 */
export function ReaderProvider({
  server,
  accessToken,
  colors,
  openLink,
  openDocument,
  children,
}: ReaderContextValue & { accessToken: string; children: ReactNode }) {
  const scale = useTextScale();
  // A stable value, so scrolling new blocks in doesn't redraw the others.
  const context = useMemo(
    () => ({ server, colors, openLink, openDocument, scale }),
    [server, colors, openLink, openDocument, scale],
  );
  return (
    <ReaderContext.Provider value={context}>
      <AccessTokenContext.Provider value={accessToken}>{children}</AccessTokenContext.Provider>
    </ReaderContext.Provider>
  );
}

/** Rich text drawn in full, for short content like a comment. Needs ReaderProvider. */
export function ReaderBlocks({ nodes }: { nodes: PMNode[] }) {
  return <Blocks nodes={nodes} />;
}

/** A reaction's emoji: the character itself, or one the workspace uploaded. Needs ReaderProvider. */
export function ReactionEmoji({ emoji }: { emoji: string }) {
  return UUID.test(emoji) ? <CustomEmoji id={emoji} /> : <Text>{emoji}</Text>;
}

/**
 * A document as a virtualised list: only what's on or near the screen is
 * drawn, so long documents open quickly on slower phones. Top-level lists
 * and tables are split into one entry per item or row, so even a huge table
 * is drawn a screenful at a time. `header` and `footer` scroll with it.
 */
export function DocumentList({
  blocks,
  header,
  footer,
  refreshControl,
  contentContainerStyle,
  server,
  accessToken,
  colors,
  openLink,
  openDocument,
  ref,
}: {
  ref?: Ref<DocumentListHandle>;
  blocks: PMNode[];
  header?: ReactElement;
  footer?: ReactElement | null;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentContainerStyle?: StyleProp<ViewStyle>;
} & ReaderContextValue & { accessToken: string }) {
  const scale = useTextScale();
  const rows = useMemo(() => toRows(blocks, scale), [blocks, scale]);
  const { listProps, thumb } = useScrollThumb<Row>(colors);
  const listRef = useRef<FlatList<Row> | null>(null);
  const jumpAttempts = useRef(0);

  useImperativeHandle(
    ref,
    () => ({
      scrollToBlock: (block) => {
        const index = rows.findIndex((row) => row.key === `${block}`);
        if (index !== -1) {
          jumpAttempts.current = 0;
          listRef.current?.scrollToIndex({ index, animated: false, viewOffset: JUMP_MARGIN });
        }
      },
    }),
    [rows],
  );

  // Rows far away aren't drawn yet, so the list can't know where they are.
  // Scroll to an estimate first, which draws that part, then jump exactly.
  function handleJumpFailed(info: { index: number; averageItemLength: number }) {
    if (jumpAttempts.current++ >= JUMP_ATTEMPTS) {
      return;
    }
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => {
      listRef.current?.scrollToIndex({ index: info.index, animated: false, viewOffset: JUMP_MARGIN });
    }, 50);
  }

  return (
    <ReaderProvider
      server={server}
      accessToken={accessToken}
      colors={colors}
      openLink={openLink}
      openDocument={openDocument}
    >
      <View style={styles.listFrame}>
        <Animated.FlatList
          {...listProps}
          ref={(list: FlatList<Row> | null) => {
            listProps.ref(list);
            listRef.current = list;
          }}
          onScrollToIndexFailed={handleJumpFailed}
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => <RowView row={item} />}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          refreshControl={refreshControl}
          contentContainerStyle={contentContainerStyle}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={9}
        />
        {thumb}
      </View>
    </ReaderProvider>
  );
}

/** Space between blocks, and between the items of one list (styles.list). */
const BLOCK_GAP = 10;
const LIST_ITEM_GAP = 4;

/**
 * The shared sideways position of a split table's rows, and the one swipe
 * handler they all use.
 */
interface TableScroll {
  x: Animated.Value;
  /** Full width of the table. */
  width: number;
  pan: PanResponderInstance;
  /** Records the width the table is shown in, which limits the scrolling. */
  setViewport: (width: number) => void;
}

type Row = { key: string; gap: number } & (
  | { kind: "block"; node: PMNode }
  | { kind: "listItem"; list: PMNode; item: PMNode; index: number }
  | { kind: "tableRow"; table: TableScroll; row: PMNode; first: boolean }
);

const LIST_TYPES = new Set(["bullet_list", "ordered_list", "checkbox_list"]);

function toRows(blocks: PMNode[], scale: number): Row[] {
  const rows: Row[] = [];
  blocks.forEach((node, b) => {
    const gap = rows.length ? BLOCK_GAP : 0;
    const items = node.content ?? [];
    if (LIST_TYPES.has(node.type) && items.length) {
      items.forEach((item, index) =>
        rows.push({ key: `${b}.${index}`, gap: index ? LIST_ITEM_GAP : gap, kind: "listItem", list: node, item, index }),
      );
    } else if (node.type === "table" && items.length) {
      const table = newTableScroll(Math.max(...items.map((row) => rowWidth(row, scale))) + StyleSheet.hairlineWidth);
      items.forEach((row, index) =>
        rows.push({ key: `${b}.${index}`, gap: index ? 0 : gap, kind: "tableRow", table, row, first: !index }),
      );
    } else {
      rows.push({ key: `${b}`, gap, kind: "block", node });
    }
  });
  return rows;
}

function newTableScroll(width: number): TableScroll {
  const x = new Animated.Value(0);
  let value = 0;
  let start = 0;
  let viewport = width;
  const clamp = (to: number) => Math.min(Math.max(to, Math.min(viewport - width, 0)), 0);

  x.addListener((event) => {
    value = event.value;
    // Momentum stops at the table's edges.
    const clamped = clamp(value);
    if (clamped !== value) {
      x.stopAnimation();
      x.setValue(clamped);
    }
  });

  const pan = PanResponder.create({
    // Only sideways swipes; vertical ones scroll the document.
    onMoveShouldSetPanResponder: (_event, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      x.stopAnimation();
      start = value;
    },
    onPanResponderMove: (_event, g) => x.setValue(clamp(start + g.dx)),
    onPanResponderRelease: (_event, g) => {
      Animated.decay(x, { velocity: g.vx, deceleration: 0.997, useNativeDriver: false }).start();
    },
  });

  return {
    x,
    width,
    pan,
    setViewport: (next) => {
      viewport = next;
    },
  };
}

function RowView({ row }: { row: Row }) {
  let content: ReactNode;
  if (row.kind === "listItem") {
    content = <ListItemView list={row.list} item={row.item} index={row.index} />;
  } else if (row.kind === "tableRow") {
    content = <SplitTableRow table={row.table} row={row.row} first={row.first} />;
  } else {
    content = <Block node={row.node} />;
  }
  return <View style={{ paddingTop: row.gap }}>{content}</View>;
}

/**
 * One row of a split table. Every row of the table shares one sideways
 * position, so swiping any row scrolls the whole table and the columns
 * stay aligned.
 */
function SplitTableRow({ table, row, first }: { table: TableScroll; row: PMNode; first: boolean }) {
  return (
    <View
      style={styles.splitTableFrame}
      onLayout={(event) => table.setViewport(event.nativeEvent.layout.width)}
      {...table.pan.panHandlers}
    >
      <Animated.View style={{ width: table.width, transform: [{ translateX: table.x }] }}>
        <TableRowView row={row} first={first} />
      </Animated.View>
    </View>
  );
}

function Blocks({ nodes }: { nodes: PMNode[] }) {
  return (
    <View style={styles.blocks}>
      {nodes.map((node, i) => (
        <Block key={i} node={node} />
      ))}
    </View>
  );
}

const headingSizes: Record<number, number> = { 1: 28, 2: 23, 3: 20, 4: 18, 5: 16, 6: 16 };

function Block({ node }: { node: PMNode }) {
  const { colors, scale } = useReader();
  const children = node.content ?? [];

  switch (node.type) {
    case "paragraph":
      return (
        <Inline
          nodes={children}
          style={{ fontSize: 16 * scale, lineHeight: 24 * scale }}
          empty={<View style={{ height: 8 * scale }} />}
        />
      );
    case "heading": {
      const level = numberAttr(node, "level") ?? 1;
      const size = (headingSizes[level] ?? 16) * scale;
      return (
        <Inline
          nodes={children}
          style={[styles.heading, { fontSize: size, lineHeight: size * 1.3 }]}
          accessibilityRole="header"
        />
      );
    }
    case "bullet_list":
    case "ordered_list":
    case "checkbox_list":
      return <List node={node} />;
    case "blockquote":
      return (
        <View style={[styles.quote, { borderColor: colors.border }]}>
          <Blocks nodes={children} />
        </View>
      );
    case "code_block":
    case "code_fence":
      return <CodeBlock code={plainText(node)} language={stringAttr(node, "language")} />;
    case "container_notice":
      return <Notice style={stringAttr(node, "style")} nodes={children} />;
    case "container_toggle":
      return <Toggle nodes={children} />;
    case "hr":
      return <View style={[styles.rule, { backgroundColor: colors.border }]} />;
    case "table":
      return <Table node={node} />;
    case "image":
      return <ReaderImage node={node} />;
    case "attachment":
      return <AttachmentCard node={node} />;
    case "video":
      return (
        <LinkCard
          icon="▶"
          title={stringAttr(node, "title") ?? "Video"}
          subtitle="Opens in the browser"
          href={stringAttr(node, "src")}
        />
      );
    case "embed": {
      const href = stringAttr(node, "href");
      return <LinkCard icon="🔗" title={hostOf(href) ?? "Embedded content"} subtitle={href} href={href} />;
    }
    case "math_block":
      return <CodeBlock code={plainText(node)} language="math" />;
    default:
      // Unknown or inline-only nodes at block level: keep their text.
      return children.length ? <Blocks nodes={children} /> : null;
  }
}

/**
 * Inline content (text with marks, mentions, emoji, maths, line breaks).
 * Images can sit inside paragraphs; they are split out as their own blocks.
 */
function Inline({
  nodes,
  style,
  empty = null,
  accessibilityRole,
}: {
  nodes: PMNode[];
  style: TextStyle | TextStyle[];
  empty?: ReactNode;
  accessibilityRole?: "header";
}) {
  const { colors } = useReader();
  const inHeaderCell = useContext(HeaderCellContext);
  if (!nodes.length) {
    return empty;
  }
  const segments: (PMNode[] | PMNode)[] = [];
  for (const node of nodes) {
    if (node.type === "image") {
      segments.push(node);
    } else if (Array.isArray(segments[segments.length - 1])) {
      (segments[segments.length - 1] as PMNode[]).push(node);
    } else {
      segments.push([node]);
    }
  }
  const textStyle = [{ color: colors.text }, style, inHeaderCell ? styles.bold : {}].flat();
  const rendered = segments.map((segment, i) =>
    Array.isArray(segment) ? (
      <Text key={i} style={textStyle} accessibilityRole={accessibilityRole}>
        {segment.map((node, j) => (
          <InlineNode key={j} node={node} />
        ))}
      </Text>
    ) : (
      <ReaderImage key={i} node={segment} />
    ),
  );
  return rendered.length === 1 ? rendered[0] : <View style={styles.blocks}>{rendered}</View>;
}

function InlineNode({ node }: { node: PMNode }) {
  const { colors, openLink, openDocument } = useReader();
  switch (node.type) {
    case "text":
      return <MarkedText node={node} />;
    case "br":
      return <Text>{"\n"}</Text>;
    case "emoji": {
      // Outline stores the shortcode ("rocket"), or the id of an emoji the
      // workspace uploaded.
      const name = stringAttr(node, "data-name") ?? "";
      if (UUID.test(name)) {
        return <CustomEmoji id={name} />;
      }
      return <Text>{(emojiNames as Record<string, string>)[name] ?? `:${name}:`}</Text>;
    }
    case "math_inline":
      return <Text style={[styles.codeInline, { backgroundColor: colors.codeBackground }]}>{plainText(node)}</Text>;
    case "mention": {
      const label = stringAttr(node, "label") ?? "";
      const modelId = stringAttr(node, "modelId");
      const isDocument = stringAttr(node, "type") === "document";
      const href = stringAttr(node, "href");
      return (
        <Text
          style={[styles.mention, { color: colors.primary }]}
          onPress={
            isDocument && modelId ? () => openDocument(modelId) : href ? () => openLink(href) : undefined
          }
        >
          {isDocument ? label : `@${label}`}
        </Text>
      );
    }
    default:
      return <Text>{plainText(node)}</Text>;
  }
}

/** An emoji the workspace uploaded, shown inline at text size. */
function CustomEmoji({ id }: { id: string }) {
  const { server, scale } = useReader();
  const accessToken = useImageToken();
  return (
    <Image
      source={{
        uri: `${server}/api/emojis.redirect?id=${id}`,
        headers: { Authorization: `Bearer ${accessToken}` },
      }}
      style={{ width: 20 * scale, height: 20 * scale }}
      contentFit="contain"
      accessibilityLabel="Emoji"
    />
  );
}

function MarkedText({ node }: { node: PMNode }) {
  const { colors, openLink } = useReader();
  const style: TextStyle = {};
  const decorations: string[] = [];
  let href: string | undefined;

  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case "strong":
        style.fontWeight = "700";
        break;
      case "em":
        style.fontStyle = "italic";
        break;
      case "underline":
        decorations.push("underline");
        break;
      case "strikethrough":
        decorations.push("line-through");
        break;
      case "code_inline":
        style.fontFamily = CODE_FONT;
        style.backgroundColor = colors.codeBackground;
        break;
      case "highlight": {
        const color = mark.attrs?.color;
        style.backgroundColor = typeof color === "string" && color ? color : "#fde68a";
        style.color = "#111111";
        break;
      }
      case "link": {
        const value = mark.attrs?.href;
        if (typeof value === "string") {
          href = value;
          style.color = colors.primary;
          decorations.push("underline");
        }
        break;
      }
      // "comment" and "placeholder" only matter inside the editor.
    }
  }
  if (decorations.length) {
    style.textDecorationLine = [...new Set(decorations)].join(" ") as TextStyle["textDecorationLine"];
  }
  return (
    <Text style={style} onPress={href ? () => openLink(href) : undefined}>
      {node.text}
    </Text>
  );
}

function List({ node }: { node: PMNode }) {
  return (
    <View style={styles.list}>
      {(node.content ?? []).map((item, i) => (
        <ListItemView key={i} list={node} item={item} index={i} />
      ))}
    </View>
  );
}

function ListItemView({ list, item, index }: { list: PMNode; item: PMNode; index: number }) {
  const { colors, scale } = useReader();
  let marker: string;
  let checked = false;
  if (list.type === "checkbox_list") {
    checked = attr(item, "checked") === true;
    marker = checked ? "☑" : "☐";
  } else if (list.type === "ordered_list") {
    marker = `${(numberAttr(list, "order") ?? 1) + index}.`;
  } else {
    marker = "•";
  }
  return (
    <View style={styles.listItem}>
      <Text
        style={[
          styles.marker,
          markerSize(scale),
          { color: colors.muted },
          list.type === "checkbox_list" && { fontSize: 18 * scale },
        ]}
        accessibilityLabel={list.type === "checkbox_list" ? (checked ? "Done" : "Not done") : undefined}
      >
        {marker}
      </Text>
      <View style={[styles.listBody, checked && styles.checked]}>
        <Blocks nodes={item.content ?? []} />
      </View>
    </View>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { colors, scale } = useReader();
  return (
    <View style={[styles.code, { backgroundColor: colors.codeBackground, borderColor: colors.border }]}>
      {language ? <Text style={[styles.codeLanguage, { color: colors.muted, fontSize: 11 * scale }]}>{language}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          style={[styles.codeText, { color: colors.codeText, fontSize: 13 * scale, lineHeight: 20 * scale }]}
          selectable
        >
          {code}
        </Text>
      </ScrollView>
    </View>
  );
}

const noticeColors: Record<string, string> = {
  info: "#3b82f6",
  warning: "#f59e0b",
  tip: "#8b5cf6",
  success: "#22c55e",
};

function Notice({ style, nodes }: { style?: string; nodes: PMNode[] }) {
  const tint = noticeColors[style ?? "info"] ?? noticeColors.info;
  return (
    <View style={[styles.notice, { borderColor: tint, backgroundColor: `${tint}22` }]}>
      <Blocks nodes={nodes} />
    </View>
  );
}

/** A collapsible block: the first child is the summary, the rest is hidden. */
function Toggle({ nodes }: { nodes: PMNode[] }) {
  const { colors, scale } = useReader();
  const [open, setOpen] = useState(false);
  const [summary, ...body] = nodes;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={styles.toggleSummary}
      >
        <Text style={[styles.marker, markerSize(scale), { color: colors.muted }]}>{open ? "▾" : "▸"}</Text>
        <View style={styles.listBody}>{summary ? <Block node={summary} /> : null}</View>
      </Pressable>
      {open ? (
        <View style={[styles.toggleBody, { paddingLeft: 8 + 22 * scale }]}>
          <Blocks nodes={body} />
        </View>
      ) : null}
    </View>
  );
}

const CELL_WIDTH = 160;

/** A table inside another block (a list, toggle, …): one horizontal scroller. */
function Table({ node }: { node: PMNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {(node.content ?? []).map((row, i) => (
          <TableRowView key={i} row={row} first={i === 0} />
        ))}
      </View>
    </ScrollView>
  );
}

function TableRowView({ row, first }: { row: PMNode; first: boolean }) {
  const { colors, scale } = useReader();
  return (
    <View style={[styles.tableRow, { borderColor: colors.border }, first && styles.tableRowFirst]}>
      {(row.content ?? []).map((cell, j) => {
        const span = numberAttr(cell, "colspan") ?? 1;
        const header = cell.type === "th";
        return (
          <View
            key={j}
            style={[
              styles.cell,
              { width: CELL_WIDTH * scale * span, borderColor: colors.border },
              header && { backgroundColor: `${colors.border}66` },
            ]}
          >
            <HeaderCellContext.Provider value={header}>
              <Blocks nodes={cell.content ?? []} />
            </HeaderCellContext.Provider>
          </View>
        );
      })}
    </View>
  );
}

function rowWidth(row: PMNode, scale: number): number {
  return (row.content ?? []).reduce(
    (sum, cell) => sum + CELL_WIDTH * scale * (numberAttr(cell, "colspan") ?? 1),
    0,
  );
}

function ReaderImage({ node }: { node: PMNode }) {
  const { server, colors } = useReader();
  const accessToken = useImageToken();
  const src = stringAttr(node, "src");
  const width = numberAttr(node, "width");
  const height = numberAttr(node, "height");
  const [ratio, setRatio] = useState(width && height ? width / height : undefined);
  if (!src) {
    return null;
  }
  // Uploaded images are relative and need the bearer token (expo-image, since
  // React Native's Image drops headers on Android); external images don't.
  const relative = src.startsWith("/");
  const uri = relative ? `${server}${src}` : src;
  const ownServer = uri.startsWith(server);
  return (
    <Image
      source={{ uri, headers: ownServer ? { Authorization: `Bearer ${accessToken}` } : undefined }}
      style={[styles.image, { aspectRatio: ratio ?? 4 / 3, backgroundColor: colors.border }]}
      contentFit="contain"
      accessibilityLabel={stringAttr(node, "alt") ?? stringAttr(node, "title")}
      onLoad={({ source }) => {
        if (!ratio && source.width && source.height) {
          setRatio(source.width / source.height);
        }
      }}
    />
  );
}

function formatBytes(bytes: number | undefined): string | undefined {
  if (!bytes) {
    return undefined;
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function AttachmentCard({ node }: { node: PMNode }) {
  return (
    <LinkCard
      icon="📎"
      title={stringAttr(node, "title") ?? "Attachment"}
      subtitle={formatBytes(numberAttr(node, "size"))}
      href={stringAttr(node, "href")}
    />
  );
}

function hostOf(href: string | undefined): string | undefined {
  if (!href) {
    return undefined;
  }
  try {
    return new URL(href).host;
  } catch {
    return undefined;
  }
}

function LinkCard({
  icon,
  title,
  subtitle,
  href,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  href?: string;
}) {
  const { colors, openLink, scale } = useReader();
  return (
    <Pressable
      accessibilityRole="link"
      disabled={!href}
      onPress={href ? () => openLink(href) : undefined}
      style={({ pressed }) => [styles.card, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
    >
      <Text style={{ fontSize: 20 * scale }}>{icon}</Text>
      <View style={styles.listBody}>
        <Text style={{ color: colors.text, fontWeight: "500", fontSize: 14 * scale }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: colors.muted, fontSize: 13 * scale }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** List and toggle markers: as tall as a line of text, and wide enough for "10.". */
function markerSize(scale: number): TextStyle {
  return { width: 22 * scale, fontSize: 16 * scale, lineHeight: 24 * scale };
}

const styles = StyleSheet.create({
  blocks: {
    gap: 10,
  },
  listFrame: {
    flex: 1,
  },
  bold: {
    fontWeight: "700",
  },
  heading: {
    fontWeight: "700",
    marginTop: 6,
  },
  list: {
    gap: 4,
  },
  listItem: {
    flexDirection: "row",
    gap: 8,
  },
  marker: {
    textAlign: "right",
  },
  listBody: {
    flex: 1,
  },
  checked: {
    opacity: 0.55,
  },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: 12,
  },
  code: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    gap: 6,
  },
  codeLanguage: {
    fontFamily: CODE_FONT,
    textTransform: "uppercase",
  },
  codeText: {
    fontFamily: CODE_FONT,
  },
  codeInline: {
    fontFamily: CODE_FONT,
  },
  mention: {
    fontWeight: "600",
  },
  notice: {
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 12,
  },
  toggleSummary: {
    flexDirection: "row",
    gap: 8,
  },
  toggleBody: {
    marginTop: 8,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  tableRow: {
    flexDirection: "row",
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  tableRowFirst: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  splitTableFrame: {
    overflow: "hidden",
  },
  cell: {
    padding: 8,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  image: {
    width: "100%",
    borderRadius: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
});
