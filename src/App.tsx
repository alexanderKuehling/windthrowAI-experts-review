import { useState } from "react"
import { ExpertReviewTab } from "./components/ExpertReviewTab"
import { Login } from "./components/Login"
import { Rankings } from "./components/Rankings"
import { LegalModal } from "./components/Legal"
import type { LegalPage } from "./components/Legal"
import { guestUser, loadStoredUser, logout } from "./utils/auth"
import type { AuthUser } from "./utils/auth"
import "./App.css"

type View = "review" | "rankings"

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser)
  const [view, setView] = useState<View>("review")
  const [legal, setLegal] = useState<LegalPage | null>(null)

  const isGuest = !!user?.guest

  function handleLogout() {
    logout()
    setUser(null)
    setView("review")
  }

  function handleGuest() {
    setUser(guestUser())
    setView("review")
  }

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
                {!isGuest && (
                  <button
                    className={`tab-btn ${view === "rankings" ? "tab-btn-active" : ""}`}
                    onClick={() => setView("rankings")}
                  >
                    Ranking
                  </button>
                )}
              </nav>

              <div className="header-user">
                {isGuest && <span className="header-guest-badge">Gastmodus</span>}
                <span className="header-username" title={user.name}>{user.name}</span>
                <button className="tab-btn" onClick={handleLogout}>
                  {isGuest ? "Beenden" : "Abmelden"}
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <main className="app-main">
        {!user ? (
          <Login onLogin={setUser} onGuest={handleGuest} />
        ) : view === "review" ? (
          <ExpertReviewTab
            reviewer={isGuest ? undefined : user.name}
            token={isGuest ? undefined : user.token}
            onSessionExpired={handleLogout}
          />
        ) : (
          <Rankings currentUser={user.name} />
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
