import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors, fonts, radius } from "@/constants/theme";

export type FeedbackKind = "loading" | "empty" | "offline" | "error";

type FeedbackCardProps = {
  kind: FeedbackKind;
  title: string;
  message: string;
};

const symbols: Record<Exclude<FeedbackKind, "loading">, string> = {
  empty: "○",
  offline: "⌁",
  error: "!",
};

export function FeedbackCard({ kind, title, message }: FeedbackCardProps) {
  return (
    <View
      accessibilityLiveRegion={kind === "error" ? "polite" : "none"}
      style={styles.card}
    >
      <View style={styles.mark}>
        {kind === "loading" ? (
          <ActivityIndicator color={colors.green} accessibilityLabel="Loading" />
        ) : (
          <Text style={styles.symbol}>{symbols[kind]}</Text>
        )}
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    borderRadius: radius.medium,
    backgroundColor: colors.surface,
  },
  mark: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.greenSoft,
  },
  symbol: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 19,
  },
  copy: {
    flex: 1,
    gap: 3,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  message: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
});
