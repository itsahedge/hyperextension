import "@mantine/core/styles.css";
import React, { useState, useEffect, useRef } from "react";
import { MantineProvider, Tabs, Burger, NavLink, Popover } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import HomePage from "../app/pages/home";
import TradePage from "../app/pages/trade";
import LeaderboardPage from "../app/pages/leaderboard/LeaderboardPage";
import WalletPage from "../app/pages/wallet";
import SettingsPage from "../app/pages/settings";
import {
  IconHome,
  IconWallet,
  IconBinoculars,
  IconArrowsDiff,
} from "@tabler/icons-react";
import type { User } from "@supabase/supabase-js";
import { sendToBackground } from "@plasmohq/messaging";
import { Storage } from "@plasmohq/storage";
import { useStorage } from "@plasmohq/storage/hook";
import { supabase } from "../app/core/supabase";
import { PopupContainer } from "../app/components/PopupContainer";
import hyperliquidIcon from "../assets/hyperliquid.png";
import { AuthScreen } from "../app/pages/auth";
import { IconHome2, IconSettings } from "@tabler/icons-react";
import Page1 from "../app/pages/example/ExamplePage1";
import Page2 from "../app/pages/example/ExamplePage2";
import ExamplePageHidden from "../app/pages/example/ExamplePageHidden";
import ActivityPage from "../app/pages/activity/ActivityPage";

function PopupTabs({
  tab,
  setTab,
}: {
  tab: string | null;
  setTab: (t: string | null) => void;
}) {
  // Hide tab bar if a subpage is open
  return (
    <Tabs
      value={tab}
      onChange={setTab}
      style={{ flex: 1, display: "flex", flexDirection: "column" }}
      variant="default"
      classNames={{
        list: "custom-tabs-list",
        tab: "custom-tab",
      }}
    >
      <div style={{ flex: 1, overflowY: "auto", marginTop: 8 }}>
        {/* Add pages here */}
        {tab === "home" && <HomePage setTab={setTab} />}
        {tab === "leaderboard" && <LeaderboardPage />}
        {tab === "trade" && <TradePage />}
        {tab === "wallet" && <WalletPage />}
        {tab === "hidden" && <ExamplePageHidden />}
        {tab === "page1" && <Page1 />}
        {tab === "page2" && <Page2 />}
        {tab === "activity" && <ActivityPage />}
        {tab === "settings" && <SettingsPage />}
      </div>
      <Tabs.List
        style={{
          position: "sticky",
          bottom: 0,
          background: "#181A20",
          zIndex: 1,
          display: "flex",
          width: "100%",
          borderTop: "1px solid #23242A",
          padding: 0,
        }}
      >
        <Tabs.Tab value="home">
          <IconHome size={24} />
        </Tabs.Tab>
        <Tabs.Tab value="trade">
          <IconArrowsDiff size={24} />
        </Tabs.Tab>
        <Tabs.Tab value="leaderboard">
          <IconBinoculars size={24} />
        </Tabs.Tab>
        <Tabs.Tab value="wallet">
          <IconWallet size={24} />
        </Tabs.Tab>
      </Tabs.List>
      <style>{`
        .custom-tabs-list {
          width: 100%;
          display: flex;
          justify-content: space-between;
          background: #181A20;
          border-top: 1px solid #23242A;
        }
        .custom-tab {
          flex: 1;
          text-align: center;
          color: #b0b0b0;
          background: none;
          border: none;
          font-size: 16px;
          font-weight: 500;
          padding: 12px 0;
          margin: 0;
          border-radius: 0;
          transition: color 0.2s;
          cursor: pointer;
        }
        .custom-tab[data-active] {
          color: #1ec9ff;
          background: none;
          border: none;
        }
      `}</style>
    </Tabs>
  );
}

function SandwichMenu({
  user,
  profile,
  onLogout,
  setTab,
  opened,
  setOpened,
}: {
  user: any;
  profile: any;
  onLogout: () => void;
  setTab: (t: string | null) => void;
  opened: boolean;
  setOpened: (o: boolean) => void;
}) {
  const toggle = () => setOpened(!opened);
  const close = () => setOpened(false);

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-start"
      withArrow
      withinPortal
      zIndex={2000}
    >
      <Popover.Target>
        <Burger
          opened={opened}
          onClick={toggle}
          aria-label="Toggle navigation"
          size="md"
          color="#b0b0b0"
        />
      </Popover.Target>
      <Popover.Dropdown
        style={{
          minWidth: 180,
          background: "#23242A",
          color: "#fff",
          borderRadius: 8,
          boxShadow: "0 2px 12px #0006",
          padding: 12,
          zIndex: 200,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {/* <NavLink
          label={user.email}
          leftSection={<IconHome2 size={16} stroke={1.5} />}
          disabled
        /> */}
        {/* <NavLink
          label={profile?.username}
          leftSection={<IconHome2 size={16} stroke={1.5} />}
          disabled
        /> */}
        <NavLink
          label="Settings"
          leftSection={<IconSettings size={16} stroke={1.5} />}
          onClick={() => {
            close();
            setTab("settings");
          }}
        />
        <NavLink
          label="Activity"
          onClick={() => {
            close();
            setTab("activity");
          }}
        />
        {/* <NavLink
          label="Page 1"
          onClick={() => {
            close();
            setTab("page1");
          }}
        /> */}
        {/* <NavLink
          label="Page 2"
          onClick={() => {
            close();
            setTab("page2");
          }}
        /> */}
        {/* <NavLink
          label="Hidden Page"
          onClick={() => {
            close();
            setTab("hidden");
          }}
        /> */}
        <NavLink
          label="Logout"
          onClick={() => {
            close();
            onLogout();
          }}
        />
      </Popover.Dropdown>
    </Popover>
  );
}

export default function Popup() {
  const [tab, setTab] = useState<string | null>("home");
  const [user, setUser] = useStorage<User | null>({
    key: "user",
    instance: new Storage({
      area: "local",
    }),
  });
  const [status, setStatus] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [menuOpened, setMenuOpened] = useState(false);

  useEffect(() => {
    async function init() {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setStatus("Error: " + error.message);
        return;
      }
      if (!!data.session) {
        setUser(data.session.user);
        sendToBackground({
          name: "init-session" as never,
          body: {
            refresh_token: data.session.refresh_token,
            access_token: data.session.access_token,
          },
        });
      }
    }
    init();
  }, [setUser]);

  useEffect(() => {
    if (user) {
      setTab("home");
      // Fetch and store user profile in local storage
      (async () => {
        const storage = new Storage({ area: "local" });
        try {
          const { data: profile, error } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();
          if (error || !profile) {
            await storage.removeItem("userProfile");
            setProfile(null);
          } else {
            await storage.setItem("userProfile", profile);
            setProfile(profile);
          }
        } catch (err) {
          await storage.removeItem("userProfile");
          setProfile(null);
        }
      })();
    }
  }, [user]);

  return (
    <MantineProvider defaultColorScheme="dark">
      {/* THESE ARE THE MAIN STYLES FOR THE APP */}
      <style>{`
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          box-sizing: border-box;
          background: #181A20 !important;
        }
        .popup-outer-container {
          width: 380px;
          height: 600px;
          background: #181A20;
          display: flex;
          flex-direction: column;
          border-radius: 0;
          overflow-y: auto;
          font-family: Inter, sans-serif;
          position: relative;
        }
        .subpage-header {
          display: flex;
          align-items: center;
          padding: 16px 16px 0 16px;
          overflow: visible;
          position: relative;
          z-index: 400;
        }
        .back-btn {
          background: #23242A;
          color: #fff;
          border: none;
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 16px;
          font-weight: 500;
          cursor: pointer;
          margin-right: 12px;
        }
      `}</style>
      <PopupContainer>
        {user ? (
          <>
            {/* Header row: Hyperliquid left, sandwich right */}
            <div
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px 0 16px",
                position: "relative",
                zIndex: 100,
                minHeight: 44,
                background: "#181A20",
                boxShadow: "0 2px 8px #0002",
              }}
            >
              <div style={{ display: "flex", alignItems: "center" }}>
                <SandwichMenu
                  user={user}
                  profile={profile}
                  onLogout={async () => {
                    await supabase.auth.signOut();
                    setUser(null);
                    setStatus("");
                  }}
                  setTab={setTab}
                  opened={menuOpened}
                  setOpened={setMenuOpened}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <img
                  src={
                    typeof hyperliquidIcon === "string"
                      ? hyperliquidIcon
                      : hyperliquidIcon.src
                  }
                  alt="Hyperliquid"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: "#fff",
                    display: "block",
                  }}
                />
                <span
                  style={{
                    color: "#b0b0b0",
                    fontSize: 13,
                    fontWeight: 500,
                    fontStyle: "italic",
                    lineHeight: "20px",
                    verticalAlign: "middle",
                    display: "inline-block",
                  }}
                >
                  <em>Powered by Hyperliquid</em>
                </span>
              </div>
            </div>
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                position: "relative",
              }}
            >
              <PopupTabs tab={tab} setTab={setTab} />
            </div>
          </>
        ) : (
          <AuthScreen setUser={setUser} status={status} setStatus={setStatus} />
        )}
      </PopupContainer>
    </MantineProvider>
  );
}
