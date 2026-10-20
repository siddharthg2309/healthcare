import { Redirect, Tabs, type Href } from "expo-router";
import { Activity, ChartLine, House, Utensils } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { AppStateProvider } from "@/lib/app-state";
import { authClient } from "@/lib/auth/client";
import { colors, fonts } from "@/constants/theme";

export default function TabLayout() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    return <View style={styles.loading}><ActivityIndicator color={colors.green} /><Text style={styles.loadingText}>Opening your account…</Text></View>;
  }
  if (!session?.user) return <Redirect href={"/sign-in" as Href} />;

  return (
    <AppStateProvider key={session.user.id}>
      <Tabs
        backBehavior="initialRoute"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.green,
          tabBarInactiveTintColor: colors.faint,
          tabBarStyle: styles.tabBar,
          tabBarLabelStyle: styles.tabLabel,
          tabBarIconStyle: styles.tabIcon,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarAccessibilityLabel: "Home tab",
            tabBarIcon: ({ color, size }) => <House color={color} size={size} strokeWidth={2} />,
          }}
        />
        <Tabs.Screen
          name="food"
          options={{
            title: "Food",
            tabBarAccessibilityLabel: "Food tracking tab",
            tabBarIcon: ({ color, size }) => <Utensils color={color} size={size} strokeWidth={2} />,
          }}
        />
        <Tabs.Screen
          name="activity"
          options={{
            title: "Activity",
            tabBarAccessibilityLabel: "Activity tracking tab",
            tabBarIcon: ({ color, size }) => <Activity color={color} size={size} strokeWidth={2} />,
          }}
        />
        <Tabs.Screen
          name="progress"
          options={{
            title: "Progress",
            tabBarAccessibilityLabel: "Goal progress tab",
            tabBarIcon: ({ color, size }) => <ChartLine color={color} size={size} strokeWidth={2} />,
          }}
        />
      </Tabs>
    </AppStateProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  loadingText: { marginTop: 11, color: colors.muted, fontFamily: fonts.medium, fontSize: 11 },
  tabBar: {
    minHeight: 64,
    paddingTop: 6,
    paddingBottom: 3,
    backgroundColor: colors.surface,
    borderTopColor: colors.line,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
  },
  tabLabel: {
    fontFamily: fonts.medium,
    fontSize: 10,
    marginTop: 1,
  },
  tabIcon: {
    marginTop: 2,
  },
});
