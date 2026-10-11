import { Image } from "expo-image";
import { createContext, useContext, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { useScrollThumb } from "@/components/reader/scroll-thumb";
import type { Colors } from "@/constants/colors";
import emojiNames from "@/lib/emoji-names.json";
import type { PMNode } from "@/lib/outline/documents";

// Renders Outline's ProseMirror JSON with native components. Every node and
// mark type in Outline's editor (shared/editor/nodes and marks) is handled;
// unknown types render their children so text is never silently dropped.

export interface ReaderContextValue {
  server: string;
  accessToken: string;
  colors: Colors;
  /** Opens a link: documents in the app, files via signed URLs, the rest in a browser. */
  openLink: (href: string) => void;
  openDocument: (id: string) => void;
}

const ReaderContext = createContext<ReaderContextValue | null>(null);

/** True inside table header cells, whose text is bold. */
const HeaderCellContext = createContext(false);

function useReader(): ReaderContextValue {
  const value = useContext(ReaderContext);
  if (!value) {
    throw new Error("Reader components must be inside DocumentList");
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

/**
 * A document as a virtualised list of its top-level blocks: only the blocks
 * on or near the screen are drawn, so long documents open quickly on slower
 * phones. `header` and `footer` scroll with the document.
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
}: {
  blocks: PMNode[];
  header?: ReactElement;
  footer?: ReactElement | null;
  refreshControl?: ReactElement<RefreshControlProps>;
  contentContainerStyle?: StyleProp<ViewStyle>;
} & ReaderContextValue) {
  // A stable value, so scrolling new blocks in doesn't redraw the others.
  const context = useMemo(
    () => ({ server, accessToken, colors, openLink, openDocument }),
    [server, accessToken, colors, openLink, openDocument],
  );
  const { listProps, thumb } = useScrollThumb<PMNode>(colors);
  return (
    <ReaderContext.Provider value={context}>
      <View style={styles.listFrame}>
        <Animated.FlatList
          {...listProps}
          data={blocks}
          keyExtractor={(_, index) => String(index)}
          renderItem={({ item }) => <Block node={item} />}
          ItemSeparatorComponent={BlockGap}
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
    </ReaderContext.Provider>
  );
}

function BlockGap() {
  return <View style={styles.blockGap} />;
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
  const { colors } = useReader();
  const children = node.content ?? [];

  switch (node.type) {
    case "paragraph":
      return <Inline nodes={children} style={styles.paragraph} empty={<View style={styles.emptyLine} />} />;
    case "heading": {
      const level = numberAttr(node, "level") ?? 1;
      const size = headingSizes[level] ?? 16;
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
      // Outline stores the shortcode ("rocket"); custom workspace emoji are
      // stored by id and aren't shown yet.
      const name = stringAttr(node, "data-name") ?? "";
      const native = (emojiNames as Record<string, string>)[name];
      return <Text>{native ?? (UUID.test(name) ? "" : `:${name}:`)}</Text>;
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
  const { colors } = useReader();
  const start = numberAttr(node, "order") ?? 1;
  return (
    <View style={styles.list}>
      {(node.content ?? []).map((item, i) => {
        let marker: string;
        let checked = false;
        if (node.type === "checkbox_list") {
          checked = attr(item, "checked") === true;
          marker = checked ? "☑" : "☐";
        } else if (node.type === "ordered_list") {
          marker = `${start + i}.`;
        } else {
          marker = "•";
        }
        return (
          <View key={i} style={styles.listItem}>
            <Text
              style={[styles.marker, { color: colors.muted }, node.type === "checkbox_list" && styles.checkbox]}
              accessibilityLabel={node.type === "checkbox_list" ? (checked ? "Done" : "Not done") : undefined}
            >
              {marker}
            </Text>
            <View style={[styles.listBody, checked && styles.checked]}>
              <Blocks nodes={item.content ?? []} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { colors } = useReader();
  return (
    <View style={[styles.code, { backgroundColor: colors.codeBackground, borderColor: colors.border }]}>
      {language ? <Text style={[styles.codeLanguage, { color: colors.muted }]}>{language}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text style={[styles.codeText, { color: colors.codeText }]} selectable>
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
  const { colors } = useReader();
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
        <Text style={[styles.marker, { color: colors.muted }]}>{open ? "▾" : "▸"}</Text>
        <View style={styles.listBody}>{summary ? <Block node={summary} /> : null}</View>
      </Pressable>
      {open ? (
        <View style={styles.toggleBody}>
          <Blocks nodes={body} />
        </View>
      ) : null}
    </View>
  );
}

const CELL_WIDTH = 160;

function Table({ node }: { node: PMNode }) {
  const { colors } = useReader();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[styles.table, { borderColor: colors.border }]}>
        {(node.content ?? []).map((row, i) => (
          <View key={i} style={styles.tableRow}>
            {(row.content ?? []).map((cell, j) => {
              const span = numberAttr(cell, "colspan") ?? 1;
              const header = cell.type === "th";
              return (
                <View
                  key={j}
                  style={[
                    styles.cell,
                    { width: CELL_WIDTH * span, borderColor: colors.border },
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
        ))}
      </View>
    </ScrollView>
  );
}

function ReaderImage({ node }: { node: PMNode }) {
  const { server, accessToken, colors } = useReader();
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
  const { colors, openLink } = useReader();
  return (
    <Pressable
      accessibilityRole="link"
      disabled={!href}
      onPress={href ? () => openLink(href) : undefined}
      style={({ pressed }) => [styles.card, { borderColor: colors.border }, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.cardIcon}>{icon}</Text>
      <View style={styles.listBody}>
        <Text style={{ color: colors.text, fontWeight: "500" }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: colors.muted, fontSize: 13 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blocks: {
    gap: 10,
  },
  blockGap: {
    height: 10,
  },
  listFrame: {
    flex: 1,
  },
  paragraph: {
    fontSize: 16,
    lineHeight: 24,
  },
  bold: {
    fontWeight: "700",
  },
  emptyLine: {
    height: 8,
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
    width: 22,
    fontSize: 16,
    lineHeight: 24,
    textAlign: "right",
  },
  checkbox: {
    fontSize: 18,
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
    fontSize: 11,
    textTransform: "uppercase",
  },
  codeText: {
    fontFamily: CODE_FONT,
    fontSize: 13,
    lineHeight: 20,
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
    paddingLeft: 30,
    marginTop: 8,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  table: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  tableRow: {
    flexDirection: "row",
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
  cardIcon: {
    fontSize: 20,
  },
});
