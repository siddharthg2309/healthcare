import { Clock3, Dumbbell, Footprints } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { FeedbackCard } from "@/components/feedback";
import { Card, MetricCard, Page, PreviewNotice, ProgressBar, ScreenHeader, SectionHeading } from "@/components/ui";
import { colors, fonts, radius } from "@/constants/theme";
import { dailyMovement, formatToday } from "@/data/demo";

export default function ActivityScreen() {
  return (
    <Page>
      <ScreenHeader
        eyebrow={formatToday()}
        title="Activity"
      />
      <PreviewNotice />

      <Card style={styles.stepsCard}>
        <View style={styles.stepsHeader}>
          <View style={styles.stepIcon}>
            <Footprints size={19} color={colors.green} />
          </View>
          <View style={styles.stepsCopy}>
            <Text style={styles.stepsLabel}>TODAY’S STEPS</Text>
            <Text style={styles.stepsValue}>{dailyMovement.steps.toLocaleString("en-IN")}</Text>
          </View>
          <Text style={styles.goalPercent}>80%</Text>
        </View>
        <ProgressBar value={dailyMovement.steps / dailyMovement.stepTarget} color={colors.limeStrong} height={9} />
        <View style={styles.stepFooter}>
          <Text style={styles.stepCaption}>Goal {dailyMovement.stepTarget.toLocaleString("en-IN")}</Text>
        </View>
      </Card>

      <View style={styles.metricRow}>
        <MetricCard
          icon="↗"
          label="Active time"
          value={String(dailyMovement.activeMinutes)}
          unit="min"
          tint={colors.greenSoft}
        />
        <MetricCard
          icon="⌁"
          label="Workouts"
          value="1"
          unit="session"
          note="Strength · 42 min"
          tint={colors.limePale}
        />
      </View>

      <SectionHeading title="Today's session" />
      <Card style={styles.workoutCard}>
        <View style={styles.workoutHeader}>
          <View style={styles.workoutIcon}>
            <Dumbbell size={18} color={colors.green} />
          </View>
          <View style={styles.workoutCopy}>
            <Text style={styles.workoutTitle}>{dailyMovement.workout}</Text>
            <Text style={styles.workoutSubtitle}>Strength · full body</Text>
          </View>
          <View style={styles.durationPill}>
            <Clock3 size={13} color={colors.green} />
            <Text style={styles.durationText}>{dailyMovement.workoutDuration}</Text>
          </View>
        </View>
        <View style={styles.exerciseList}>
          <View style={styles.exerciseRow}>
            <Text style={styles.exerciseName}>Goblet squat</Text>
            <Text style={styles.exerciseSets}>3 sets · 10 reps</Text>
          </View>
          <View style={styles.exerciseRow}>
            <Text style={styles.exerciseName}>Dumbbell row</Text>
            <Text style={styles.exerciseSets}>3 sets · 10 reps</Text>
          </View>
          <View style={[styles.exerciseRow, styles.lastExercise]}>
            <Text style={styles.exerciseName}>Incline push-up</Text>
            <Text style={styles.exerciseSets}>3 sets · 8 reps</Text>
          </View>
        </View>
      </Card>

      <SectionHeading title="Phone activity" />
      <FeedbackCard
        kind="empty"
        title="Health Connect"
        message="Coming soon · manual steps are available."
      />

    </Page>
  );
}

const styles = StyleSheet.create({
  stepsCard: {
    backgroundColor: colors.limePale,
    borderColor: colors.limePale,
    gap: 15,
  },
  stepsHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  stepIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  stepsCopy: {
    flex: 1,
    gap: 3,
  },
  stepsLabel: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 0.75,
  },
  stepsValue: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 26,
    letterSpacing: -0.8,
  },
  goalPercent: {
    color: colors.green,
    fontFamily: fonts.bold,
    fontSize: 19,
  },
  stepFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  stepCaption: {
    color: colors.green,
    fontFamily: fonts.medium,
    fontSize: 10,
  },
  metricRow: {
    flexDirection: "row",
    gap: 12,
  },
  workoutCard: {
    gap: 16,
  },
  workoutHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  workoutIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: colors.greenSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  workoutCopy: {
    flex: 1,
    gap: 4,
  },
  workoutTitle: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  workoutSubtitle: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 11,
  },
  durationPill: {
    minHeight: 29,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.greenSoft,
  },
  durationText: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 10,
  },
  exerciseList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  exerciseRow: {
    minHeight: 45,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  lastExercise: {
    borderBottomWidth: 0,
  },
  exerciseName: {
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  exerciseSets: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 10,
  },
});
