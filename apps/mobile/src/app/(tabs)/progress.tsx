import { ArrowRight, Scale, Target } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { ProgressChart } from "@/components/progress-chart";
import { Card, Page, PreviewNotice, ScreenHeader, SectionHeading } from "@/components/ui";
import { colors, fonts, radius } from "@/constants/theme";
import { formatToday, progressWeek } from "@/data/demo";

function LegendItem({ kind, label }: { kind: "plan" | "trend" | "weight"; label: string }) {
  return (
    <View style={styles.legendItem}>
      {kind === "weight" ? (
        <View style={styles.legendPoint} />
      ) : (
        <View style={[styles.legendLine, kind === "plan" && styles.planLine]} />
      )}
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

export default function ProgressScreen() {
  return (
    <Page>
      <ScreenHeader
        eyebrow={formatToday()}
        title="Your progress"
        subtitle="The goal path beside your real check-ins."
      />
      <PreviewNotice />

      <View style={styles.summaryCard}>
        <View style={styles.summaryTop}>
          <View style={styles.summaryIcon}>
            <Scale size={19} color={colors.green} />
          </View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryLabel}>LATEST WEIGHT TREND</Text>
            <Text style={styles.summaryValue}>79.5<Text style={styles.summaryUnit}> kg</Text></Text>
          </View>
          <View style={styles.weekBadge}>
            <Text style={styles.weekBadgeNumber}>3</Text>
            <Text style={styles.weekBadgeLabel}>of 12 weeks</Text>
          </View>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.comparisonRow}>
          <View style={styles.comparisonItem}>
            <Text style={styles.comparisonLabel}>Goal line today</Text>
            <Text style={styles.comparisonValue}>79.4 kg</Text>
          </View>
          <View style={styles.comparisonDivider} />
          <View style={styles.comparisonItem}>
            <Text style={styles.comparisonLabel}>Difference</Text>
            <Text style={styles.differenceValue}>0.1 kg above</Text>
          </View>
        </View>
      </View>

      <SectionHeading title="Plan and measurements" detail="Weight · kilograms" />
      <Card style={styles.chartCard}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={styles.chartTitle}>Last 7 days</Text>
            <Text style={styles.chartSubtitle}>A measured trend, not a prediction</Text>
          </View>
          <View style={styles.goalMark}>
            <Target size={16} color={colors.green} />
          </View>
        </View>

        <ProgressChart days={progressWeek} />

        <View style={styles.legend}>
          <LegendItem kind="plan" label="Goal plan" />
          <LegendItem kind="trend" label="Measured trend" />
          <LegendItem kind="weight" label="Weigh-in" />
        </View>

        <View style={styles.chartFootnote}>
          <Text style={styles.footnoteText}>Days without a weigh-in stay blank.</Text>
          <Text style={styles.coverage}>5 of 7 days</Text>
        </View>
      </Card>

      <SectionHeading title="Your goal" detail="Sample plan values" />
      <Card style={styles.goalCard}>
        <View style={styles.goalRow}>
          <View style={styles.goalCopy}>
            <Text style={styles.goalLabel}>Starting weight</Text>
            <Text style={styles.goalValue}>80.0 kg</Text>
          </View>
          <ArrowRight size={16} color={colors.faint} />
          <View style={[styles.goalCopy, styles.goalEnd]}>
            <Text style={styles.goalLabel}>Target weight</Text>
            <Text style={styles.goalValue}>70.0 kg</Text>
          </View>
        </View>
        <View style={styles.goalBar}>
          <View style={styles.goalBarFill} />
          <View style={styles.goalBarDot} />
        </View>
        <Text style={styles.goalCaption}>12-week example timeline · review with your own measurements</Text>
      </Card>

      <View style={styles.explanation}>
        <Text style={styles.explanationTitle}>How to read this graph</Text>
        <Text style={styles.explanationText}>
          The dashed green line is the accepted goal path. The dark line smooths recorded measurements. Green dots show individual weigh-ins. Nutrition and activity totals are shown separately and do not claim to explain a same-day weight change.
        </Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: radius.large,
    backgroundColor: colors.limePale,
    padding: 19,
    gap: 15,
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryCopy: {
    flex: 1,
    gap: 3,
  },
  summaryLabel: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 0.65,
  },
  summaryValue: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 26,
    letterSpacing: -0.8,
  },
  summaryUnit: {
    fontFamily: fonts.medium,
    fontSize: 14,
    letterSpacing: 0,
  },
  weekBadge: {
    minWidth: 62,
    height: 58,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  weekBadgeNumber: {
    color: colors.green,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  weekBadgeLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 8,
  },
  summaryDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#CFE5A7",
  },
  comparisonRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  comparisonItem: {
    flex: 1,
    gap: 4,
  },
  comparisonDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: "#CFE5A7",
    marginHorizontal: 12,
  },
  comparisonLabel: {
    color: colors.green,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  comparisonValue: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  differenceValue: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  chartCard: {
    gap: 12,
    paddingHorizontal: 15,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  chartTitle: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  chartSubtitle: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 10,
    marginTop: 3,
  },
  goalMark: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.greenSoft,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingTop: 1,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendLine: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.text,
  },
  planLine: {
    height: 0,
    borderTopWidth: 2,
    borderTopColor: colors.limeStrong,
    borderStyle: "dashed",
    backgroundColor: "transparent",
  },
  legendPoint: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.green,
    backgroundColor: colors.lime,
  },
  legendLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 9,
  },
  chartFootnote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 10,
  },
  footnoteText: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 10,
  },
  coverage: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 10,
  },
  goalCard: {
    gap: 15,
  },
  goalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  goalCopy: {
    flex: 1,
    gap: 4,
  },
  goalEnd: {
    alignItems: "flex-end",
  },
  goalLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  goalValue: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 17,
  },
  goalBar: {
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    justifyContent: "center",
  },
  goalBarFill: {
    width: "20%",
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.limeStrong,
  },
  goalBarDot: {
    position: "absolute",
    left: "20%",
    width: 14,
    height: 14,
    marginLeft: -7,
    borderRadius: 7,
    backgroundColor: colors.green,
    borderWidth: 3,
    borderColor: colors.surface,
  },
  goalCaption: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 15,
  },
  explanation: {
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  explanationTitle: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 12,
  },
  explanationText: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 17,
  },
});
