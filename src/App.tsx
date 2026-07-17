import { useState } from "react"
import { ExpertReviewTab } from "./components/ExpertReviewTab"
import { Login } from "./components/Login"
import { Rankings } from "./components/Rankings"
import { loadStoredUser, logout } from "./utils/auth"
import type { AuthUser } from "./utils/auth"
import "./App.css"

type View = "review" | "rankings"

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser)
  const [view, setView] = useState<View>("review")

  function handleLogout() {
    logout()
    setUser(null)
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
                <button
                  className={`tab-btn ${view === "rankings" ? "tab-btn-active" : ""}`}
                  onClick={() => setView("rankings")}
                >
                  Ranking
                </button>
              </nav>

              <div className="header-user">
                <span className="header-username" title={user.name}>{user.name}</span>
                <button className="tab-btn" onClick={handleLogout}>Abmelden</button>
              </div>
            </>
          )}
        </div>
      </header>

      <main className="app-main">
        {!user ? (
          <Login onLogin={setUser} />
        ) : view === "review" ? (
          <ExpertReviewTab
            reviewer={user.name}
            token={user.token}
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
        </a>
      </footer>
    </div>
  )
}
