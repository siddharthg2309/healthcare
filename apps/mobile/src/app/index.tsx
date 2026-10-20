import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

import { colors, fonts, radius } from "@/constants/theme";

function getAppUrl(): URL | null {
  const configured = process.env.EXPO_PUBLIC_APP_URL?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    const secure = url.protocol === "https:";
    const localDevelopment = __DEV__ && url.protocol === "http:";
    if ((!secure && !localDevelopment) || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function SetupMessage() {
  return (
    <View style={styles.messageWrap}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>GH</Text></View>
      <Text style={styles.eyebrow}>GOAL HEALTH · ANDROID</Text>
      <Text style={styles.title}>App address needed</Text>
      <Text style={styles.body}>
        This build needs the HTTPS address of the deployed Goal Health app. Set EXPO_PUBLIC_APP_URL in the EAS production environment, then create a new APK.
      </Text>
    </View>
  );
}

function OfflineMessage({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.messageWrap}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>GH</Text></View>
      <Text style={styles.eyebrow}>GOAL HEALTH · ANDROID</Text>
      <Text style={styles.title}>Can’t reach your app</Text>
      <Text style={styles.body}>Check the internet connection and try again. Your account and health records stay on the hosted service.</Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
        <Text style={styles.retryLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function AppScreen() {
  const webView = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const appUrl = useMemo(() => getAppUrl(), []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack || loadError) return false;
      webView.current?.goBack();
      return true;
    });
    return () => subscription.remove();
  }, [canGoBack, loadError]);

  if (!appUrl) {
    return <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}><SetupMessage /></SafeAreaView>;
  }

  const appAddress = appUrl.href;
  const trustedOrigin = appUrl.origin;

  function handleNavigation(request: { url: string }): boolean {
    if (request.url === "about:blank") return true;
    try {
      const destination = new URL(request.url);
      if (destination.origin === trustedOrigin && (destination.protocol === "https:" || (__DEV__ && destination.protocol === "http:"))) return true;
      if (destination.protocol === "https:" && !destination.username && !destination.password) {
        void Linking.openURL(destination.href).catch(() => undefined);
      }
    } catch {
      // Block malformed URLs and non-web schemes from navigating inside the app.
    }
    return false;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      {loadError ? <OfflineMessage onRetry={() => { setLoadError(false); setLoading(true); webView.current?.reload(); }} /> : (
        <>
          <WebView
            ref={webView}
            source={{ uri: appAddress }}
            originWhitelist={["https://*", ...( __DEV__ ? ["http://*"] : [])]}
            onShouldStartLoadWithRequest={handleNavigation}
            onNavigationStateChange={(navigation) => setCanGoBack(navigation.canGoBack)}
            onLoadStart={() => { setLoadError(false); setLoading(true); }}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setLoadError(true);
            }}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            javaScriptCanOpenWindowsAutomatically={false}
            setSupportMultipleWindows={false}
            mixedContentMode="never"
            allowsBackForwardNavigationGestures
            style={styles.webView}
          />
          {loading ? <View pointerEvents="none" style={styles.loading}><ActivityIndicator color={colors.green} size="large" /></View> : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  webView: { flex: 1, backgroundColor: colors.background },
  loading: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  messageWrap: { flex: 1, justifyContent: "center", alignItems: "flex-start", paddingHorizontal: 28, gap: 12 },
  brandMark: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.card, backgroundColor: colors.lime },
  brandMarkText: { color: colors.green, fontFamily: fonts.bold, fontSize: 13 },
  eyebrow: { color: colors.green, fontFamily: fonts.semibold, fontSize: 9, letterSpacing: 1 },
  title: { color: colors.text, fontFamily: fonts.bold, fontSize: 27, letterSpacing: -0.7 },
  body: { maxWidth: 360, color: colors.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 21 },
  retryButton: { minHeight: 46, justifyContent: "center", alignItems: "center", marginTop: 5, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.lime },
  retryLabel: { color: colors.text, fontFamily: fonts.semibold, fontSize: 12 },
  pressed: { opacity: 0.78 },
});
