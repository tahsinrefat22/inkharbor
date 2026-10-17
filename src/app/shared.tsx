import { router, Stack, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Button } from "@/components/button";
import { useColors } from "@/constants/colors";
import { useAuth } from "@/lib/auth";
import { documentIdFromLink } from "@/lib/outline/documents";
import type { Session } from "@/lib/session";
import { firstLink, hostOf, isFrontPage, isOnServer, pathOf, setPendingLink } from "@/lib/shared-link";

/** Reads what another app shared, once, and lets go of it. */
function readSharedText(): string {
  try {
    const text = Sharing.getSharedPayloads()
      .map((payload) => payload.value ?? "")
      .join("\n");
    Sharing.clearSharedPayloads();
    return text;
  } catch {
    return "";
  }
}

type Outcome =
  | { kind: "waiting" }
  /** Locked or not connected: the home screen takes over and opens it later. */
  | { kind: "later"; link: string }
  | { kind: "open"; documentId: string }
  /** The server's front page: its home screen in the app. */
  | { kind: "home" }
  /** On another saved server: switch to it, then this screen opens the link there. */
  | { kind: "switch"; accountId: string }
  | { kind: "noLink" }
  | { kind: "otherServer"; link: string; host: string }
  | { kind: "notDocument"; link: string };

function decide(shared: string, status: string, session: Session | null, sessions: Session[]): Outcome {
  if (status === "loading") {
    return { kind: "waiting" };
  }
  const link = firstLink(shared);
  if (!link) {
    return { kind: "noLink" };
  }
  if (status !== "ready" || !session) {
    return { kind: "later", link };
  }
  if (!isOnServer(link, session.server)) {
    const other = sessions.find((s) => isOnServer(link, s.server));
    return other ? { kind: "switch", accountId: other.id } : { kind: "otherServer", link, host: hostOf(link) };
  }
  if (isFrontPage(link)) {
    return { kind: "home" };
  }
  const documentId = documentIdFromLink(pathOf(link), session.server);
  return documentId ? { kind: "open", documentId } : { kind: "notDocument", link };
}

/**
 * Where a link shared to Inkharbor lands. A document on the open server
 * opens in the app, replacing this screen; one on another of the user's
 * servers opens after switching to it; anything else gets an explanation
 * and the browser as a way out. `url` is set when the home screen hands over
 * a link that was shared while the app was locked.
 */
export default function SharedScreen() {
  const colors = useColors();
  const { status, session, sessions, switchAccount } = useAuth();
  const params = useLocalSearchParams<{ url?: string }>();
  const [shared] = useState(() => params.url ?? readSharedText());
  // Decided again when the open account changes, e.g. after switching.
  const outcome = useMemo(
    () => decide(shared, status, session, sessions),
    [shared, status, session, sessions],
  );

  useEffect(() => {
  }, [params.url, shared]);
  useEffect(() => {
    if (outcome.kind === "later") {
      setPendingLink(outcome.link);
      router.replace("/");
    } else if (outcome.kind === "switch") {
      // Once the other account is open, this screen is decided again and
      // replaces itself with the document.
      switchAccount(outcome.accountId);
    } else if (outcome.kind === "home") {
      router.dismissTo("/");
    } else if (outcome.kind === "open") {
      router.replace({ pathname: "/document/[id]", params: { id: outcome.documentId } });
    }
  }, [outcome, switchAccount]);

  if (outcome.kind === "waiting" || outcome.kind === "later" || outcome.kind === "open" || outcome.kind === "switch" || outcome.kind === "home") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Opening…" }} />
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  const message = {
    noLink: "There's no link in what was shared, so there's nothing to open.",
    otherServer:
      outcome.kind === "otherServer"
        ? sessions.length > 1
          ? `This link is on ${outcome.host}, which isn't one of your Outline servers. You can add it from the account menu.`
          : `This link is on ${outcome.host}, not on the Outline server you're connected to.`
        : "",
    notDocument: "Inkharbor can open links to documents. This one points somewhere else in Outline.",
  }[outcome.kind];
  const link = outcome.kind === "noLink" ? null : outcome.link;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Shared link" }} />
      <Text style={[styles.title, { color: colors.text }]}>{"Can't open this in Inkharbor"}</Text>
      <Text style={{ color: colors.muted }}>{message}</Text>
      {link ? (
        <Text style={[styles.link, { color: colors.muted }]} numberOfLines={3} selectable>
          {link}
        </Text>
      ) : null}
      {link ? (
        <Button title="Open in browser" variant="primary" onPress={() => WebBrowser.openBrowserAsync(link)} />
      ) : null}
      <Button title="Go to home" onPress={() => router.replace("/")} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
  },
  link: {
    fontSize: 13,
  },
});
