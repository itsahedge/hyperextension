import { useState, useEffect } from "react";
import { supabase } from "../../core/supabase";
import { AdminTurnkeyClient } from "@/lib/turnkey";
import type { Provider, User } from "@supabase/supabase-js";
import { Storage } from "@plasmohq/storage";
import { UserProfile } from "@/app/core/types";
import { Tabs, TextInput, PasswordInput, Button } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

function SignInForm({
  onLogin,
  status,
}: {
  onLogin: (username: string, password: string) => void;
  status: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, { toggle }] = useDisclosure(false);

  useEffect(() => {
    setUsername("");
    setPassword("");
  }, []);

  return (
    <form
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: 12,
        marginTop: 24,
        alignItems: "center",
      }}
      onSubmit={(e) => {
        e.preventDefault();
        onLogin(username, password);
      }}
    >
      <TextInput
        label="Email"
        placeholder="Your Email"
        value={username}
        onChange={(e) => setUsername(e.currentTarget.value)}
        required
        style={{ width: "100%" }}
      />
      <PasswordInput
        label="Password"
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        visible={visible}
        onVisibilityChange={toggle}
        required
        style={{ width: "100%" }}
      />
      <Button type="submit" fullWidth>
        Login
      </Button>
      <div style={{ color: "red", marginTop: 8, width: "100%" }}>{status}</div>
    </form>
  );
}

function SignUpForm({
  onSignup,
  status,
}: {
  onSignup: (username: string, password: string) => void;
  status: string;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [visible, { toggle }] = useDisclosure(false);

  useEffect(() => {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setConfirmError("");
  }, []);

  return (
    <form
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        gap: 12,
        marginTop: 24,
        alignItems: "center",
      }}
      onSubmit={(e) => {
        e.preventDefault();
        setConfirmError("");
        if (password !== confirmPassword) {
          setConfirmError("Passwords do not match");
          return;
        }
        onSignup(username, password);
      }}
    >
      <TextInput
        label="Email"
        placeholder="Your Email"
        value={username}
        onChange={(e) => setUsername(e.currentTarget.value)}
        required
        style={{ width: "100%" }}
      />
      <PasswordInput
        label="Password"
        placeholder="Your password"
        value={password}
        onChange={(e) => setPassword(e.currentTarget.value)}
        visible={visible}
        onVisibilityChange={toggle}
        required
        style={{ width: "100%" }}
      />
      <PasswordInput
        label="Confirm password"
        placeholder="Repeat your password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.currentTarget.value)}
        visible={visible}
        onVisibilityChange={toggle}
        required
        error={confirmError}
        style={{ width: "100%" }}
      />
      <Button type="submit" fullWidth>
        Sign up
      </Button>
      <div style={{ color: "red", marginTop: 8, width: "100%" }}>{status}</div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 8, width: "100%" }}>
        After signing up, check your email to confirm, then return here to log
        in.
      </div>
    </form>
  );
}

export function AuthScreen({
  setUser,
  status,
  setStatus,
}: {
  setUser: (u: User | null) => void;
  status: string;
  setStatus: (s: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<"signin" | "signup">("signin");

  useEffect(() => {
    setStatus("");
  }, [activeTab, setStatus]);

  const handleEmailLogin = async (
    type: "LOGIN" | "SIGNUP",
    username: string,
    password: string
  ) => {
    try {
      const {
        error,
        data: { user },
      } =
        type === "LOGIN"
          ? await supabase.auth.signInWithPassword({
              email: username,
              password,
            })
          : await supabase.auth.signUp({ email: username, password });

      if (error) {
        setStatus("Error with auth: " + error.message);
        return;
      } else if (type === "SIGNUP") {
        setStatus(
          "Please check your email to confirm signup, then return here to log in."
        );
        return;
      } else if (
        type === "LOGIN" &&
        user &&
        user.id &&
        user.email &&
        user.aud === "authenticated"
      ) {
        // ...existing onboarding/profile logic...
        const { data: existingProfiles, error: fetchProfileError } =
          await supabase.from("profiles").select("*").eq("id", user.id);

        if (fetchProfileError) {
          setStatus("Error checking profile: " + fetchProfileError.message);
          return;
        }

        let userData: UserProfile | null = null;
        if (!existingProfiles || existingProfiles.length === 0) {
          const adminTurnkeyClient = new AdminTurnkeyClient();
          const {
            subOrgId,
            privateKey,
            publicKey,
            walletId,
            addresses,
            publicKeyUncompressed,
          } = await adminTurnkeyClient.onboardUser(user.id, user.email);

          if (!subOrgId || !privateKey || !publicKey || !walletId) {
            setStatus("Error creating turnkey wallet");
            return;
          }

          const { data: newProfile, error: profileError } = await supabase
            .from("profiles")
            .insert({
              id: user.id,
              ethereum_address: addresses[0],
              sub_organization_id: subOrgId, // encrypted
              p256_pub_key: publicKey,
              p256_private_key: privateKey, // encrypted
              p256_pub_key_uncompressed: publicKeyUncompressed, // TODO: should encrypt
              wallet_id: walletId,
            })
            .select("*");
          if (profileError || !newProfile || newProfile.length === 0) {
            setStatus(
              "Error creating profile: " +
                (profileError?.message || "No data returned")
            );
            return;
          }
          userData = newProfile[0];
        } else {
          userData = existingProfiles[0];
        }

        if (!userData) {
          setStatus("Error getting user data");
          return;
        }

        // Store user profile in local storage
        const storage = new Storage({ area: "local" });
        await storage.setItem("userProfile", userData);

        setUser(user);
        setStatus("");
      }
    } catch (error: any) {
      setStatus(error.error_description || error.message || String(error));
    }
  };

  return (
    <div style={{ color: "#fff", padding: 16, minHeight: "100vh" }}>
      <h2>Sign In / Sign Up</h2>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          minHeight: "70vh",
        }}
      >
        <Tabs
          value={activeTab}
          onChange={(tab) => setActiveTab(tab as "signin" | "signup")}
          style={{ width: 320 }}
        >
          <Tabs.List grow>
            <Tabs.Tab value="signin">Sign In</Tabs.Tab>
            <Tabs.Tab value="signup">Sign Up</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="signin">
            <SignInForm
              onLogin={(username, password) =>
                handleEmailLogin("LOGIN", username, password)
              }
              status={status}
            />
          </Tabs.Panel>
          <Tabs.Panel value="signup">
            <SignUpForm
              onSignup={(username, password) =>
                handleEmailLogin("SIGNUP", username, password)
              }
              status={status}
            />
          </Tabs.Panel>
        </Tabs>
      </div>
    </div>
  );
}
