import { ExpertReviewTab } from "./components/ExpertReviewTab"
import "./App.css"

export default function App() {
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
        </div>
      </header>

      <main className="app-main">
        <ExpertReviewTab />
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
