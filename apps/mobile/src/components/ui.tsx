import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, fonts, radius, spacing } from "@/constants/theme";

type PageProps = {
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
};

export function Page({ children, contentStyle }: PageProps) {
  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[styles.pageContent, contentStyle]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

type ScreenHeaderProps = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  accessory?: ReactNode;
};

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  accessory,
}: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text accessibilityRole="header" style={styles.screenTitle}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {accessory}
    </View>
  );
}

export function PreviewNotice() {
  return (
    <View style={styles.previewNotice}>
      <View style={styles.previewDot} />
      <Text style={styles.previewText}>SAMPLE DATA</Text>
    </View>
  );
}

type CardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Card({ children, style }: CardProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type SectionHeadingProps = {
  title: string;
  detail?: string;
  accessory?: ReactNode;
};

export function SectionHeading({
  title,
  detail,
  accessory,
}: SectionHeadingProps) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionCopy}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
        {detail ? <Text style={styles.sectionDetail}>{detail}</Text> : null}
      </View>
      {accessory}
    </View>
  );
}

type ProgressBarProps = {
  value: number;
  color?: string;
  trackColor?: string;
  height?: number;
};

export function ProgressBar({
  value,
  color = colors.green,
  trackColor = colors.surfaceSoft,
  height = 8,
}: ProgressBarProps) {
  const boundedValue = Math.max(0, Math.min(value, 1));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(boundedValue * 100) }}
      style={[styles.progressTrack, { height, backgroundColor: trackColor }]}
    >
      <View
        style={[
          styles.progressFill,
          { width: (boundedValue * 100 + "%") as DimensionValue, backgroundColor: color },
        ]}
      />
    </View>
  );
}

type MacroBarProps = {
  label: string;
  value: number;
  target: number;
  tint: string;
};

export function MacroBar({ label, value, target, tint }: MacroBarProps) {
  const portion = target > 0 ? value / target : 0;
  return (
    <View style={styles.macroItem}>
      <View style={styles.macroTop}>
        <Text style={styles.macroLabel}>{label}</Text>
        <Text style={styles.macroValue}>
          {value}
          <Text style={styles.macroTarget}> / {target} g</Text>
        </Text>
      </View>
      <ProgressBar value={portion} color={tint} height={6} />
    </View>
  );
}

type PillProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Pill({ children, style }: PillProps) {
  return <View style={[styles.pill, style]}>{children}</View>;
}

type MetricCardProps = {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  icon: string;
  tint?: string;
};

export function MetricCard({
  label,
  value,
  unit,
  note,
  icon,
  tint = colors.limePale,
}: MetricCardProps) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: tint }]}>
        <Text style={styles.metricIconText}>{icon}</Text>
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricValueRow}>
        <Text style={styles.metricValue}>{value}</Text>
        {unit ? <Text style={styles.metricUnit}>{unit}</Text> : null}
      </View>
      {note ? <Text style={styles.metricNote}>{note}</Text> : null}
    </View>
  );
}

export const textStyles = StyleSheet.create({
  body: {
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
  },
  muted: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
  },
  small: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 15,
  },
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageContent: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    paddingHorizontal: spacing.screen,
    paddingTop: 14,
    paddingBottom: 30,
    gap: 18,
  },
  header: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 3,
  },
  eyebrow: {
    color: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  screenTitle: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 27,
    letterSpacing: -0.8,
    lineHeight: 33,
  },
  headerSubtitle: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  previewNotice: {
    minHeight: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 11,
    gap: 7,
  },
  previewDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.green,
  },
  previewText: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 0.65,
  },
  card: {
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    padding: spacing.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ECEFE9",
  },
  sectionHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginTop: 3,
  },
  sectionCopy: {
    gap: 3,
  },
  sectionTitle: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 16,
    letterSpacing: -0.2,
  },
  sectionDetail: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 12,
  },
  progressTrack: {
    width: "100%",
    overflow: "hidden",
    borderRadius: radius.pill,
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.pill,
  },
  macroItem: {
    gap: 8,
  },
  macroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  macroLabel: {
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 13,
  },
  macroValue: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 12,
  },
  macroTarget: {
    color: colors.muted,
    fontFamily: fonts.regular,
  },
  pill: {
    minHeight: 28,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  metricCard: {
    minHeight: 142,
    flex: 1,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#ECEFE9",
    padding: 16,
    gap: 7,
  },
  metricIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  metricIconText: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  metricLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  metricValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 5,
  },
  metricValue: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 23,
    letterSpacing: -0.6,
  },
  metricUnit: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 11,
  },
  metricNote: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
  },
});
