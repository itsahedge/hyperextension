import { useEffect, useState } from "react"

function OptionsPage() {
  const [status, setStatus] = useState("Verifying...")

  useEffect(() => {
    // Optionally, you could parse tokens here, but it's not required for Supabase email confirmation
    setStatus("Successfully signed up! You can exit this page and use the extension.")
  }, [])

  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        width: "100vw",
        height: "100vh",
        flexDirection: "column"
      }}>
      <h2>{status}</h2>
      <div style={{ marginTop: 16, color: "#888" }}>
        You may now close this tab and use the extension popup to log in.
      </div>
    </main>
  )
}

export default OptionsPage
