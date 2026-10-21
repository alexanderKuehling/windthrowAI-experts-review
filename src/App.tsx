import { useState } from "react"
import { ExpertReviewTab } from "./components/ExpertReviewTab"
import { ChannelsTab } from "./components/ChannelsTab"
import { Login } from "./components/Login"
import { Rankings } from "./components/Rankings"
import { LegalModal } from "./components/Legal"
import type { LegalPage } from "./components/Legal"
import { SESSION_EXPIRED_NOTICE, guestUser, loadStoredUser, logout } from "./utils/auth"
import type { AuthUser } from "./utils/auth"
import { AppStateProvider } from "./state/AppState"
import { useSessionGuard } from "./state/useSessionGuard"
import "./App.css"

type View = "review" | "channels" | "rankings"

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser)
  const [view, setView] = useState<View>("review")
  const [legal, setLegal] = useState<LegalPage | null>(null)
  // Shown on the login screen after the backend rejected the stored session,
  // so being signed out doesn't look like a glitch.
  const [loginNotice, setLoginNotice] = useState<string | null>(null)

  const isGuest = !!user?.guest

  function handleLogout() {
    // A guest has no stored session; clearing storage would sign out a
    // reviewer in another tab.
    if (!user?.guest) logout()
    setUser(null)
    setView("review")
  }

  function handleSessionExpired() {
    handleLogout()
    setLoginNotice(SESSION_EXPIRED_NOTICE)
  }

  function handleLogin(next: AuthUser) {
    setLoginNotice(null)
    setUser(next)
  }

  function handleGuest() {
    setLoginNotice(null)
    setUser(guestUser())
    setView("review")
  }

  // Another tab signed in or out. A guest tab isn't tied to the stored
  // session, so it carries on as it is.
  function handleStoredUserChange(next: AuthUser | null) {
    if (user?.guest || next?.token === user?.token) return
    setUser(next)
    setView("review")
  }

  useSessionGuard(user, handleSessionExpired, handleStoredUserChange)

  return (
    <div id="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <div className="logo-group">
            <div className="logo-mark">
              <svg viewBox="0 0 16 16">
                <path d="M8 2v12M4 6l4-4 4 4M3 14h10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <span className="logo-text">WindthrowAI</span>
              <span className="logo-sub"> — Expert Review</span>
            </div>
          </div>

          {user && (
            <>
              <nav className="header-nav">
                <button
                  className={`tab-btn ${view === "review" ? "tab-btn-active" : ""}`}
                  onClick={() => setView("review")}
                >
                  Review
                </button>
                <button
                  className={`tab-btn ${view === "channels" ? "tab-btn-active" : ""}`}
                  onClick={() => setView("channels")}
                >
                  Channels
                </button>
                {!isGuest && (
                  <button
                    className={`tab-btn ${view === "rankings" ? "tab-btn-active" : ""}`}
                    onClick={() => setView("rankings")}
                  >
                    Rankings
                  </button>
                )}
              </nav>

              <div className="header-user">
                {isGuest && <span className="header-guest-badge">Guest mode</span>}
                <span className="header-username" title={user.name}>{user.name}</span>
                <button className="tab-btn" onClick={handleLogout}>
                  {isGuest ? "Sign in" : "Sign out"}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <main className="app-main">
        {!user ? (
          <Login notice={loginNotice} onLogin={handleLogin} onGuest={handleGuest} />
        ) : (
          <AppStateProvider
            token={isGuest ? undefined : user.token}
            onSessionExpired={handleSessionExpired}
          >
            {view === "review" ? (
              <ExpertReviewTab
                reviewer={isGuest ? undefined : user.name}
                token={isGuest ? undefined : user.token}
                onSessionExpired={handleSessionExpired}
                onOpenChannels={() => setView("channels")}
              />
            ) : view === "channels" ? (
              <ChannelsTab />
            ) : (
              <Rankings currentUser={user.name} />
            )}
          </AppStateProvider>
        )}
      </main>

      <footer className="app-footer">
        WindthrowAI &middot; Expert review of tropical forest windthrow segmentation &middot;{" "}
        <a href="https://huggingface.co/alexKlg" target="_blank" rel="noreferrer">
          HuggingFace
        </a>{" "}
        &middot;{" "}
        <button className="footer-link" onClick={() => setLegal("imprint")}>
          Imprint
        </button>{" "}
        &middot;{" "}
        <button className="footer-link" onClick={() => setLegal("privacy")}>
          Privacy
        </button>
      </footer>

      {legal && <LegalModal page={legal} onClose={() => setLegal(null)} />}
    </div>
  )
}
