import { Link } from "expo-router";
import { ArrowRight, Flame, Footprints, Salad } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card, MacroBar, Page, PreviewNotice, ProgressBar, ScreenHeader, SectionHeading, textStyles } from "@/components/ui";
import { colors, fonts, radius } from "@/constants/theme";
import { dailyMovement, dailyNutrition, demoMeals, formatToday } from "@/data/demo";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function MealSummary() {
  return (
    <View style={styles.mealList}>
      {demoMeals.map((meal) => (
        <View key={meal.name} style={styles.mealRow}>
          <View style={[styles.mealMark, { backgroundColor: meal.tint }]}>
            <Text style={styles.mealMarkText}>{meal.mark}</Text>
          </View>
          <View style={styles.mealCopy}>
            <Text style={styles.mealName}>{meal.name}</Text>
            <Text style={styles.mealDetail}>{meal.detail}</Text>
          </View>
          <Text style={styles.mealCalories}>{meal.kcal} kcal</Text>
        </View>
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const remaining = dailyNutrition.target - dailyNutrition.eaten;

  return (
    <Page>
      <ScreenHeader
        eyebrow={formatToday()}
        title={greeting()}
        subtitle="A little progress adds up."
        accessory={
          <View accessibilityLabel="Profile preview" style={styles.avatar}>
            <Text style={styles.avatarText}>H</Text>
          </View>
        }
      />
      <PreviewNotice />

      <Link href="/progress" asChild>
        <Pressable
          accessibilityLabel="Open goal progress"
          accessibilityRole="button"
          style={({ pressed }) => [styles.weeklyCard, pressed && styles.pressed]}
        >
          <View style={styles.weeklyTop}>
            <View style={styles.weeklyIcon}>
              <ArrowRight size={18} color={colors.green} strokeWidth={2.4} />
            </View>
            <Text style={styles.weeklyLabel}>YOUR GOAL PATH</Text>
            <View style={styles.weeklySpacer} />
            <Text style={styles.weeklyArrow}>↗</Text>
          </View>
          <View style={styles.weeklyBottom}>
            <View style={styles.weeklyCopy}>
              <Text style={styles.weeklyTitle}>Steady progress</Text>
              <Text style={styles.weeklySubtitle}>0.5 kg down · Week 3 of 12</Text>
            </View>
            <View style={styles.weeklyPill}>
              <Text style={styles.weeklyPillValue}>4/7</Text>
              <Text style={styles.weeklyPillLabel}>check-ins</Text>
            </View>
          </View>
        </Pressable>
      </Link>

      <SectionHeading title="Today at a glance" detail="Your food and movement" />
      <Card style={styles.calorieCard}>
        <View style={styles.cardTitleRow}>
          <View style={styles.cardIcon}>
            <Flame size={17} color={colors.green} fill={colors.lime} />
          </View>
          <Text style={styles.cardTitle}>Calories</Text>
          <View style={styles.flexSpacer} />
          <Text style={styles.remaining}>{remaining} left</Text>
        </View>
        <View style={styles.calorieValueRow}>
          <Text style={styles.calorieValue}>{dailyNutrition.eaten.toLocaleString("en-IN")}</Text>
          <Text style={styles.calorieTarget}> / {dailyNutrition.target.toLocaleString("en-IN")} kcal</Text>
        </View>
        <ProgressBar value={dailyNutrition.eaten / dailyNutrition.target} color={colors.limeStrong} height={9} />
        <View style={styles.macroGrid}>
          <MacroBar label="Protein" value={dailyNutrition.protein} target={dailyNutrition.proteinTarget} tint={colors.green} />
          <MacroBar label="Carbs" value={dailyNutrition.carbs} target={dailyNutrition.carbsTarget} tint={colors.orange} />
          <MacroBar label="Fat" value={dailyNutrition.fat} target={dailyNutrition.fatTarget} tint={colors.blue} />
        </View>
      </Card>

      <View style={styles.sectionRow}>
        <SectionHeading title="Movement" detail="So far today" />
        <Link href="/activity" asChild>
          <Pressable accessibilityRole="link" style={styles.textLink}>
            <Text style={styles.textLinkLabel}>Details</Text>
          </Pressable>
        </Link>
      </View>
      <View style={styles.metricsRow}>
        <Card style={styles.movementCard}>
          <View style={[styles.smallIcon, { backgroundColor: colors.orangeSoft }]}>
            <Footprints size={18} color={colors.orange} />
          </View>
          <Text style={styles.movementLabel}>Steps</Text>
          <Text style={styles.movementValue}>{dailyMovement.steps.toLocaleString("en-IN")}</Text>
          <Text style={styles.movementDetail}>of {dailyMovement.stepTarget.toLocaleString("en-IN")} goal</Text>
          <ProgressBar value={dailyMovement.steps / dailyMovement.stepTarget} color={colors.orange} height={5} />
        </Card>
        <Card style={styles.movementCard}>
          <View style={[styles.smallIcon, { backgroundColor: colors.greenSoft }]}>
            <Salad size={18} color={colors.green} />
          </View>
          <Text style={styles.movementLabel}>Active time</Text>
          <Text style={styles.movementValue}>{dailyMovement.activeMinutes} min</Text>
          <Text style={styles.movementDetail}>of a 45 min goal</Text>
          <ProgressBar value={dailyMovement.activeMinutes / 45} color={colors.green} height={5} />
        </Card>
      </View>

      <SectionHeading
        title="Food today"
        detail="Sample meal log"
        accessory={
          <Link href="/food" asChild>
            <Pressable accessibilityRole="link" style={styles.textLink}>
              <Text style={styles.textLinkLabel}>View all</Text>
            </Pressable>
          </Link>
        }
      />
      <Card style={styles.mealsCard}>
        <MealSummary />
      </Card>
      <View style={styles.footerHint}>
        <Text style={styles.footerHintText}>
          Your progress graph compares measured check-ins with your chosen goal path.
        </Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: colors.limePale,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: colors.green,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  weeklyCard: {
    borderRadius: radius.large,
    padding: 19,
    backgroundColor: colors.limePale,
    gap: 19,
  },
  weeklyTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  weeklyIcon: {
    width: 32,
    height: 32,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.lime,
    transform: [{ rotate: "-35deg" }],
  },
  weeklyLabel: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 10,
    letterSpacing: 1,
  },
  weeklySpacer: {
    flex: 1,
  },
  weeklyArrow: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 20,
  },
  weeklyBottom: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  weeklyCopy: {
    gap: 4,
  },
  weeklyTitle: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 20,
    letterSpacing: -0.5,
  },
  weeklySubtitle: {
    color: colors.green,
    fontFamily: fonts.medium,
    fontSize: 12,
  },
  weeklyPill: {
    minWidth: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  weeklyPillValue: {
    color: colors.green,
    fontFamily: fonts.bold,
    fontSize: 17,
  },
  weeklyPillLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 8,
  },
  calorieCard: {
    gap: 14,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  cardIcon: {
    width: 33,
    height: 33,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.greenSoft,
  },
  cardTitle: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  flexSpacer: {
    flex: 1,
  },
  remaining: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  calorieValueRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: -4,
  },
  calorieValue: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 31,
    letterSpacing: -1.2,
  },
  calorieTarget: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  macroGrid: {
    gap: 12,
    paddingTop: 2,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  textLink: {
    paddingVertical: 8,
    paddingHorizontal: 5,
  },
  textLinkLabel: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 12,
  },
  metricsRow: {
    flexDirection: "row",
    gap: 12,
  },
  movementCard: {
    flex: 1,
    gap: 9,
    padding: 15,
  },
  smallIcon: {
    width: 35,
    height: 35,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  movementLabel: {
    color: colors.muted,
    fontFamily: fonts.medium,
    fontSize: 12,
    marginTop: 2,
  },
  movementValue: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 20,
    letterSpacing: -0.5,
  },
  movementDetail: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 10,
  },
  mealsCard: {
    paddingVertical: 8,
  },
  mealList: {
    gap: 0,
  },
  mealRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  mealMark: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  mealMarkText: {
    color: colors.green,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  mealCopy: {
    flex: 1,
    gap: 4,
  },
  mealName: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  mealDetail: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 10,
  },
  mealCalories: {
    color: colors.text,
    fontFamily: fonts.medium,
    fontSize: 11,
  },
  footerHint: {
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  footerHintText: {
    ...textStyles.muted,
    textAlign: "center",
    fontSize: 11,
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
});
