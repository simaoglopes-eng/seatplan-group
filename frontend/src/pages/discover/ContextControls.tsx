// Where and when: a city (or "near me"), and optionally a date, a time and how many people.
// On a wide screen it is one compact capsule in the command bar; on a phone the same four
// controls sit stacked, with visible labels, inside the filters drawer. Only one of the two
// is ever on the page.
import { Select } from "../../design/components";
import { DiscoveryDate } from "./DiscoveryDate";
import { CITIES } from "./discoverModel";
import type { Place } from "./discoverModel";
export const PARTIES = Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "1 person" : `${i + 1} people` }));
const NEAR = "__near";
const TIMES = Array.from({ length: 96 }, (_, index) =>
  `${String(Math.floor(index / 4)).padStart(2, "0")}:${String(index % 4 * 15).padStart(2, "0")}`);
interface Props {
  place: Place | null;
  onPlace: (place: Place | null) => void;
  date: string;
  time: string;
  party: string;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  onParty: (value: string) => void;
  onClearWhen: () => void;
  variant: "capsule" | "stacked";
}
/** The options of the city list; "Near me" is there only while the location is in use. */
function cityOptions(place: Place | null): { value: string; label: string }[] {
  const near = place?.label === "Near me" ? [{ value: NEAR, label: "Near me" }] : [];
  return [{ value: "", label: "Anywhere" }, ...near, ...CITIES.map((c) => ({ value: c.label, label: c.label }))];
}
function timeOptions(value: string) {
  const times = value && !TIMES.includes(value) ? [...TIMES, value].sort() : TIMES;
  return [{ value: "", label: "Choose a time" }, ...times.map(time => ({ value: time, label: time }))];
}

function CapsuleSelect({ label, name, value, onChange, options }: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return <label><span>{label}</span><select className="select-themed" aria-label={name} value={value}
    onChange={event => onChange(event.target.value)}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select></label>;
}
export function ContextControls({ place, onPlace, date, time, party, onDate, onTime, onParty, onClearWhen, variant }: Props) {
  const cityValue = place ? (place.label === "Near me" ? NEAR : place.label) : "";
  const changeCity = (value: string): void => {
    if (value === NEAR) return;
    onPlace(CITIES.find((c) => c.label === value) ?? null);
  };
  if (variant === "stacked") {
    return (
      <div className="discover-stacked">
        <Select className="select-themed" label="Choose a city" value={cityValue} options={cityOptions(place)} onChange={(event) => changeCity(event.target.value)} />
        <DiscoveryDate value={date} onChange={onDate} stacked />
        <Select className="select-themed" label="Time" value={time} options={timeOptions(time)} onChange={event => onTime(event.target.value)} />
        <Select className="select-themed" label="People" value={party} options={PARTIES} onChange={(event) => onParty(event.target.value)} />
      </div>
    );
  }
  return (
    <div className="discover-capsule" role="group" aria-label="Where and when">
      <CapsuleSelect label="Where" name="Choose a city" value={cityValue} options={cityOptions(place)} onChange={changeCity} />
      <DiscoveryDate value={date} onChange={onDate} stacked={false} />
      <CapsuleSelect label="Around" name="Time" value={time} options={timeOptions(time)} onChange={onTime} />
      <CapsuleSelect label="Guests" name="People" value={party} options={PARTIES} onChange={onParty} />
      {date && (
        <button type="button" className="discover-capsule-clear" aria-label="Clear the date" onClick={onClearWhen}>
          ×
        </button>
      )}
    </div>
  );
}
