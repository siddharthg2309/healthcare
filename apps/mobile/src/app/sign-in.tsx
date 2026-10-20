import { useEffect, useState, type ComponentProps } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { authClient } from "@/lib/auth/client";
import { colors, fonts, radius, spacing } from "@/constants/theme";

type Mode = "sign_in" | "sign_up";

export default function SignInScreen() {
  const { data: session, isPending, refetch } = authClient.useSession();
  const [mode, setMode] = useState<Mode>("sign_in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invitationCode, setInvitationCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isPending && session?.user) router.replace("/");
  }, [isPending, session?.user]);

  async function submit() {
    setError("");
    if (mode === "sign_up" && !invitationCode.trim()) {
      setError("Enter the invitation code sent to your email.");
      return;
    }
    setBusy(true);
    try {
      const result = mode === "sign_up"
        ? await authClient.signUp.email(
            { name: name.trim(), email: email.trim(), password },
            { headers: { "x-invitation-code": invitationCode.trim() } },
          )
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) {
        setError(result.error.message || "Check your details and try again.");
        return;
      }
      await refetch();
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>GH</Text></View>
            <Text style={styles.eyebrow}>PRIVATE BY ACCOUNT</Text>
            <Text accessibilityRole="header" style={styles.heroTitle}>Small steps.{"\n"}<Text style={styles.heroAccent}>Visible change.</Text></Text>
            <Text style={styles.heroCopy}>Food, movement, and the goal line you chose in one calm view.</Text>
          </View>

          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.cardTitle}>{mode === "sign_up" ? "Create your account" : "Welcome back"}</Text>
            <Text style={styles.cardCopy}>{mode === "sign_up" ? "Use the invitation code shared with you." : "Sign in to see your private health records."}</Text>
            {mode === "sign_up" ? <Field label="Name" value={name} onChangeText={setName} autoComplete="name" returnKeyType="next" /> : null}
            <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" returnKeyType="next" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === "sign_up" ? "new-password" : "current-password"} returnKeyType="done" />
            {mode === "sign_up" ? <Field label="Invitation code" value={invitationCode} onChangeText={setInvitationCode} autoCapitalize="none" returnKeyType="go" /> : null}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable accessibilityRole="button" disabled={busy || isPending} onPress={() => void submit()} style={({ pressed }) => [styles.primaryButton, (pressed || busy) && styles.pressed]}>
              {busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryButtonText}>{mode === "sign_up" ? "Create account" : "Sign in"}</Text>}
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setMode(mode === "sign_in" ? "sign_up" : "sign_in"); setError(""); }} style={styles.modeButton}>
              <Text style={styles.modeButtonText}>{mode === "sign_up" ? "Already have an account? Sign in" : "Have an invitation? Create an account"}</Text>
            </Pressable>
          </View>
          <Text style={styles.privacy}>Your records are private to your account. Friends cannot see them.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, ...props }: { label: string } & ComponentProps<typeof TextInput>) {
  return <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      {...props}
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={colors.faint}
      style={styles.input}
      autoCorrect={false}
      textContentType={label === "Password" ? "password" : label === "Email" ? "emailAddress" : "none"}
    />
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flexGrow: 1, justifyContent: "center", gap: 22, padding: spacing.screen, paddingTop: 28, paddingBottom: 32 },
  hero: { gap: 10, paddingHorizontal: 4 },
  brandMark: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: colors.lime },
  brandMarkText: { color: colors.green, fontFamily: fonts.bold, fontSize: 13 },
  eyebrow: { marginTop: 8, color: colors.green, fontFamily: fonts.semibold, fontSize: 9, letterSpacing: 1 },
  heroTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 32, lineHeight: 37, letterSpacing: -1 },
  heroAccent: { color: colors.green },
  heroCopy: { maxWidth: 300, color: colors.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 19 },
  card: { gap: 13, padding: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.line, borderRadius: radius.large, backgroundColor: colors.surface },
  cardTitle: { color: colors.text, fontFamily: fonts.bold, fontSize: 20, letterSpacing: -0.5 },
  cardCopy: { marginTop: -7, marginBottom: 2, color: colors.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17 },
  field: { gap: 6 },
  fieldLabel: { color: colors.text, fontFamily: fonts.semibold, fontSize: 10 },
  input: { minHeight: 48, paddingHorizontal: 13, borderWidth: 1, borderColor: colors.line, borderRadius: 14, backgroundColor: "#FBFCFA", color: colors.text, fontFamily: fonts.medium, fontSize: 13 },
  error: { color: colors.red, fontFamily: fonts.medium, fontSize: 11, lineHeight: 16 },
  primaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.lime },
  primaryButtonText: { color: colors.text, fontFamily: fonts.bold, fontSize: 12 },
  pressed: { opacity: 0.75 },
  modeButton: { minHeight: 36, alignItems: "center", justifyContent: "center" },
  modeButtonText: { color: colors.green, fontFamily: fonts.semibold, fontSize: 10 },
  privacy: { color: colors.faint, fontFamily: fonts.regular, fontSize: 9, lineHeight: 15, textAlign: "center" },
});
