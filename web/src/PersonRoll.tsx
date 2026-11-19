import { useEffect, useState } from "react";
import { maskText } from "../../shared/self-service";
import type { StageView } from "../../shared/stage";

export function Portrait({ name, photo }: { name: string; photo?: string }) {
  const [failed, setFailed] = useState(false);
  return photo && !failed
    ? <img className="stage-person-portrait" src={photo} alt="" onError={() => setFailed(true)} />
    : <div className="stage-person-portrait stage-person-placeholder" aria-hidden="true">{name.slice(0, 1)}</div>;
}

export default function PersonRoll({ people, running, masked = true }: {
  people: StageView["participants"];
  running: boolean;
  masked?: boolean;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick(value => value + 1), 160);
    return () => clearInterval(timer);
  }, [running]);
  const samples = Array.from({ length: Math.min(5, people.length) },
    (_, index) => people[((running ? tick : 0) + index) % people.length]);
  if (!samples.length) return <p>当前没有符合条件的来宾</p>;
  return <div className="stage-portrait-strip" data-running={running} data-testid="stage-portrait-strip">
    <div className="stage-portrait-track">
      {samples.map(person => <div key={person.id} className="stage-portrait-card">
        <Portrait key={person.photo} name={person.name} photo={person.photo} />
        <b>{masked ? maskText(person.name) : person.name}</b>
      </div>)}
    </div>
  </div>;
}
