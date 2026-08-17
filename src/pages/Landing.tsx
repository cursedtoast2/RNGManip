import { routeHref } from "../routing";

export default function Landing() {
  return (
    <div className="site-page">
      <div className="site-page-inner">
        <header className="site-hero">
          <h1>Guided shiny RNG manipulation for Pokémon</h1>
          <p className="site-lede">
            Pick your game, set up your save, then work through Secret ID handling, a shiny target search, a
            console-specific timer, and result matching that calibrates your next attempt.
          </p>
        </header>

        <section className="game-cards" aria-label="Games">
          <a className="game-card" href={routeHref("/frlg")}>
            <div className="game-card-body">
              <h2>FireRed / LeafGreen</h2>
              <p>
                The hunt workflow for Gen 3 Kanto: starters; legendary, stationary, gift, and fossil encounters; and
                Game Corner prizes.
              </p>
            </div>
          </a>

          <a className="game-card" href={routeHref("/rse")}>
            <div className="game-card-body">
              <h2>Ruby / Sapphire / Emerald</h2>
              <p>
                The hunt workflow for Gen 3 Hoenn: starters plus legendary, stationary, gift, and fossil encounters.
              </p>
            </div>
          </a>
        </section>
      </div>
    </div>
  );
}
