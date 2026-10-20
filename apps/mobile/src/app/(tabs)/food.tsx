import { Flame, Plus, Search, ScanLine } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { Card, MacroBar, Page, PreviewNotice, ProgressBar, ScreenHeader, SectionHeading } from "@/components/ui";
import { colors, fonts, radius } from "@/constants/theme";
import { dailyNutrition, demoMeals, formatToday } from "@/data/demo";

export default function FoodScreen() {
  const remaining = dailyNutrition.target - dailyNutrition.eaten;

  return (
    <Page>
      <ScreenHeader
        eyebrow={formatToday()}
        title="Food"
        subtitle="A clear picture of what you ate."
      />
      <PreviewNotice />

      <Card style={styles.intakeCard}>
        <View style={styles.intakeHeader}>
          <View style={styles.flameIcon}>
            <Flame size={18} color={colors.green} fill={colors.lime} />
          </View>
          <View style={styles.intakeCopy}>
            <Text style={styles.overline}>DAILY INTAKE</Text>
            <Text style={styles.intakeTitle}>Calories</Text>
          </View>
          <Text style={styles.remaining}>{remaining} left</Text>
        </View>
        <View style={styles.calorieRow}>
          <Text style={styles.calorieValue}>{dailyNutrition.eaten.toLocaleString("en-IN")}</Text>
          <Text style={styles.calorieTarget}> / {dailyNutrition.target.toLocaleString("en-IN")} kcal</Text>
        </View>
        <ProgressBar value={dailyNutrition.eaten / dailyNutrition.target} color={colors.limeStrong} height={10} />
      </Card>

      <SectionHeading title="Macros" detail="From your sample food log" />
      <Card style={styles.macroCard}>
        <MacroBar label="Protein" value={dailyNutrition.protein} target={dailyNutrition.proteinTarget} tint={colors.green} />
        <MacroBar label="Carbohydrates" value={dailyNutrition.carbs} target={dailyNutrition.carbsTarget} tint={colors.orange} />
        <MacroBar label="Fat" value={dailyNutrition.fat} target={dailyNutrition.fatTarget} tint={colors.blue} />
      </Card>

      <SectionHeading title="Add food" detail="Manual search and photo-assisted entry" />
      <View style={styles.actionGrid}>
        <View style={styles.actionCard}>
          <View style={[styles.actionIcon, { backgroundColor: colors.greenSoft }]}>
            <Search size={20} color={colors.green} />
          </View>
          <Text style={styles.actionTitle}>Search foods</Text>
          <Text style={styles.actionDetail}>Choose a food and confirm its portion.</Text>
          <View style={styles.comingSoon}>
            <Text style={styles.comingSoonText}>PLANNED</Text>
          </View>
        </View>
        <View style={styles.actionCard}>
          <View style={[styles.actionIcon, { backgroundColor: colors.limePale }]}>
            <ScanLine size={20} color={colors.green} />
          </View>
          <Text style={styles.actionTitle}>Use a photo</Text>
          <Text style={styles.actionDetail}>Review suggested dishes before logging.</Text>
          <View style={styles.comingSoon}>
            <Text style={styles.comingSoonText}>PLANNED</Text>
          </View>
        </View>
      </View>

      <SectionHeading title="Today's meals" detail="Values shown are sample data" />
      <Card style={styles.mealsCard}>
        {demoMeals.map((meal, index) => (
          <View
            key={meal.name}
            style={[
              styles.mealRow,
              index === demoMeals.length - 1 && styles.lastMealRow,
            ]}
          >
            <View style={[styles.mealMark, { backgroundColor: meal.tint }]}>
              <Text style={styles.mealMarkText}>{meal.mark}</Text>
            </View>
            <View style={styles.mealText}>
              <Text style={styles.mealName}>{meal.name}</Text>
              <Text style={styles.mealDetail}>{meal.detail}</Text>
            </View>
            <Text style={styles.mealCalories}>{meal.kcal} kcal</Text>
          </View>
        ))}
      </Card>

      <View style={styles.noteCard}>
        <Plus size={16} color={colors.green} />
        <Text style={styles.noteText}>
          Nutrition totals come from confirmed foods and portions. Photo suggestions never set a serving size by themselves.
        </Text>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  intakeCard: {
    backgroundColor: colors.limePale,
    borderColor: colors.limePale,
    gap: 16,
  },
  intakeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  flameIcon: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  intakeCopy: {
    flex: 1,
    gap: 3,
  },
  overline: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  intakeTitle: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 14,
  },
  remaining: {
    color: colors.green,
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  calorieRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 2,
  },
  calorieValue: {
    color: colors.text,
    fontFamily: fonts.bold,
    fontSize: 36,
    letterSpacing: -1.3,
  },
  calorieTarget: {
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 13,
  },
  macroCard: {
    gap: 18,
  },
  actionGrid: {
    flexDirection: "row",
    gap: 12,
  },
  actionCard: {
    flex: 1,
    minHeight: 178,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 15,
    gap: 9,
  },
  actionIcon: {
    width: 39,
    height: 39,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  actionTitle: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  actionDetail: {
    flex: 1,
    color: colors.muted,
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 15,
  },
  comingSoon: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: colors.surfaceSoft,
  },
  comingSoonText: {
    color: colors.muted,
    fontFamily: fonts.semibold,
    fontSize: 8,
    letterSpacing: 0.5,
  },
  mealsCard: {
    paddingVertical: 4,
  },
  mealRow: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  lastMealRow: {
    borderBottomWidth: 0,
  },
  mealMark: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  mealMarkText: {
    color: colors.green,
    fontFamily: fonts.bold,
    fontSize: 14,
  },
  mealText: {
    flex: 1,
    gap: 4,
  },
  mealName: {
    color: colors.text,
    fontFamily: fonts.semibold,
    fontSize: 12,
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
  noteCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderRadius: radius.medium,
    backgroundColor: colors.greenSoft,
    padding: 14,
  },
  noteText: {
    flex: 1,
    color: colors.green,
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 17,
  },
});
