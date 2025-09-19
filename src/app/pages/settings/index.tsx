import { Text, Paper } from "@mantine/core";
import { useEffect, useState } from "react";
import { Storage } from "@plasmohq/storage";
import { PopupContainer } from "../../components/PopupContainer";

export default function SettingsPage() {
  const [profile, setProfile] = useState<any>(null);
  //   const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      setError(null);
      try {
        const storage = new Storage({ area: "local" });
        const userProfileRaw = await storage.getItem("userProfile");
        let userProfile: any = null;
        if (typeof userProfileRaw === "string") {
          try {
            userProfile = JSON.parse(userProfileRaw);
          } catch {
            userProfile = null;
          }
        } else if (
          typeof userProfileRaw === "object" &&
          userProfileRaw !== null
        ) {
          userProfile = userProfileRaw;
        }
        setProfile(userProfile);
      } catch (err: any) {
        setError(err.message || String(err));
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  if (loading) {
    return (
      <div style={{ color: "#fff", padding: 16 }}>
        <Text>Loading...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ color: "#fff", padding: 16 }}>
        <Text c="red">{error}</Text>
      </div>
    );
  }

  return (
    <PopupContainer>
      <div style={{ color: "#fff", padding: 16 }}>
        <Paper shadow="sm" radius="md" p="xl">
          <Text size="1.4rem" fw={700} ta="center">
            {profile?.username ? `@${profile.username}` : "Username not set"}
          </Text>
        </Paper>
      </div>
      {profile && (
        <pre
          style={{
            marginTop: 16,
            background: "#181A20",
            color: "#fff",
            padding: 12,
            borderRadius: 8,
            maxWidth: 600,
            overflowX: "auto",
          }}
        >
          {JSON.stringify(profile, null, 2)}
        </pre>
      )}
    </PopupContainer>
  );
}
