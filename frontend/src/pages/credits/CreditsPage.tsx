// Route /credits: who made the photographs the site shows and under which licence,
// as the licences ask, plus the OpenStreetMap line for the venue directory.
// The list itself lives in src/data/photoCredits.ts, grouped as CREDIT_GROUPS says.
import { PageShell } from "../../design/components";
import { CREDIT_GROUPS, PHOTO_CREDITS } from "../../data/photoCredits";
import type { PhotoCredit } from "../../data/photoCredits";
import { PublicHeaderActions } from "../discover/PublicHeaderActions";
import "./credits.css";

export default function CreditsPage() {
  return (
    <PageShell title="Credits" headerActions={<PublicHeaderActions />}>
      <div className="cr-page">
        <p className="cr-eyebrow">Credits</p>
        <h1>Photographs and data</h1>
        <p className="cr-lede">
          The photographs come from Wikimedia Commons, used under the licence each author chose. A photo marked "Venue photo" shows that venue from the directory. Illustrative photos show a kind of room, not the venue: in the directory they carry the label "Illustrative photo".
        </p>

        {CREDIT_GROUPS.map((group) => {
          const credits = PHOTO_CREDITS.filter((credit) => credit.group === group.key);
          if (credits.length === 0) return null;
          return (
            <section key={group.key} aria-labelledby={`cr-${group.key}`}>
              <h2 id={`cr-${group.key}`}>
                {group.title} <span className="cr-count">({credits.length})</span>
              </h2>
              <ul className="cr-list">
                {credits.map((credit) => (
                  <CreditItem key={credit.file} credit={credit} />
                ))}
              </ul>
            </section>
          );
        })}

        <h2>Venue data</h2>
        <p>
          The venue directory is built from OpenStreetMap. Venue data{" "}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            © OpenStreetMap contributors<span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          , available under the Open Database Licence (ODbL).
        </p>
      </div>
    </PageShell>
  );
}

function CreditItem({ credit }: { credit: PhotoCredit }) {
  return (
    <li className="cr-item">
      <img src={credit.file} alt="" width={160} height={107} loading="lazy" decoding="async" />
      <div>
        <p className="cr-title">{credit.title}</p>
        <p className="cr-meta">
          {credit.author} ·{" "}
          <a href={credit.licenceUrl} target="_blank" rel="noopener noreferrer license">
            {credit.licence}
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </p>
        <p className="cr-meta">{credit.usedFor}</p>
        <a className="cr-source" href={credit.sourceUrl} target="_blank" rel="noopener noreferrer">
          Source on Wikimedia Commons<span className="visually-hidden">: {credit.title} (opens in a new tab)</span> <span aria-hidden="true">↗</span>
        </a>
      </div>
    </li>
  );
}
