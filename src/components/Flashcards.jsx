import { useState } from "react";

export default function Flashcards({ cards }) {
  const [flipped, setFlipped] = useState({});
  return (
    <>
      <p className="hint">Tap a card to flip it.</p>
      <div className="cards">
        {cards.map((c, i) => (
          <button
            key={i}
            style={{ "--i": i }}
            className={`flashcard ${flipped[i] ? "flipped" : ""}`}
            onClick={() => setFlipped((f) => ({ ...f, [i]: !f[i] }))}
            aria-label={flipped[i] ? `Answer: ${c.back}` : `Question: ${c.front}`}
          >
            <div className="inner">
              <div className="face front">{c.front}</div>
              <div className="face back">{c.back}</div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}
