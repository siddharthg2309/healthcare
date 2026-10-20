import type { ComponentProps, ComponentType } from "react";
import { View } from "react-native";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";

import { colors, fonts } from "@/constants/theme";
import type { ProgressDay } from "@/data/demo";

type SvgLabelProps = ComponentProps<typeof SvgText> & {
  style?: { fontFamily?: string };
};

const SvgLabel = SvgText as ComponentType<SvgLabelProps>;

const WIDTH = 340;
const HEIGHT = 202;
const LEFT = 44;
const RIGHT = 10;
const TOP = 16;
const PLOT_BOTTOM = 160;
const MIN_WEIGHT = 78.5;
const MAX_WEIGHT = 80.5;

function pointX(index: number, count: number) {
  if (count <= 1) return LEFT;
  return LEFT + (index * (WIDTH - LEFT - RIGHT)) / (count - 1);
}

function pointY(weight: number) {
  return TOP + ((MAX_WEIGHT - weight) / (MAX_WEIGHT - MIN_WEIGHT)) * (PLOT_BOTTOM - TOP);
}

function linePath(values: (number | null)[]) {
  let drawing = false;
  const commands: string[] = [];

  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    const command = drawing ? "L" : "M";
    commands.push(command + " " + pointX(index, values.length) + " " + pointY(value));
    drawing = true;
  });

  return commands.join(" ");
}

type ProgressChartProps = {
  days: ProgressDay[];
};

export function ProgressChart({ days }: ProgressChartProps) {
  const planValues = days.map((day) => day.plan);
  const trendValues = days.map((day) => day.trend);
  const yTicks = [80, 79.5, 79, 78.5];

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Sample weight progress chart. The dashed green line is the goal plan. The dark solid line is the measured trend. Green circles are individual weigh-ins. Missing weigh-ins are not shown as zero."
      style={{ width: "100%" }}
    >
      <Svg
        width="100%"
        height={HEIGHT}
        viewBox={"0 0 " + WIDTH + " " + HEIGHT}
        preserveAspectRatio="none"
      >
        {yTicks.map((tick) => {
          const y = pointY(tick);
          return (
            <G key={tick}>
              <Line
                x1={LEFT}
                y1={y}
                x2={WIDTH - RIGHT}
                y2={y}
                stroke={colors.line}
                strokeWidth={1}
              />
              <SvgLabel
                x={LEFT - 8}
                y={y + 4}
                fill={colors.muted}
                fontSize={10}
                style={{ fontFamily: fonts.regular }}
                textAnchor="end"
              >
                {tick}
              </SvgLabel>
            </G>
          );
        })}

        <Path
          d={linePath(planValues)}
          fill="none"
          stroke={colors.limeStrong}
          strokeWidth={2.5}
          strokeDasharray="6 6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={linePath(trendValues)}
          fill="none"
          stroke={colors.text}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {days.map((day, index) => {
          const x = pointX(index, days.length);
          const actual = day.actual;
          return (
            <G key={day.day}>
              {actual === null ? null : (
                <Circle
                  cx={x}
                  cy={pointY(actual)}
                  r={5}
                  fill={colors.lime}
                  stroke={colors.green}
                  strokeWidth={2}
                />
              )}
              <SvgLabel
                x={x}
                y={HEIGHT - 13}
                fill={colors.muted}
                fontSize={10}
                style={{ fontFamily: fonts.regular }}
                textAnchor="middle"
              >
                {day.day}
              </SvgLabel>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
