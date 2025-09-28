import Image from "next/image";
import Link from "next/link";

export default function AboutPage() {
  return (
    <>
      <div className="relative bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200 py-4 w-full">
        <a href="/events" className="absolute top-4 left-4 inline-flex items-center gap-2 text-blue-900 hover:text-blue-800 font-semibold text-xl px-3 py-1 transition-opacity active:opacity-40">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden="true">
            <path fillRule="evenodd" d="M9.53 4.47a.75.75 0 0 1 0 1.06L4.81 10.25H21a.75.75 0 0 1 0 1.5H4.81l4.72 4.72a.75.75 0 1 1-1.06 1.06l-6-6a.75.75 0 0 1 0-1.06l6-6a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
          </svg>
          Back
        </a>
      </div>
      <div className="p-6 max-w-3xl mx-auto space-y-8">
        <div className="flex items-center justify-center mb-4">
          <Link href="/">
            <Image src="/logo.png" alt="Happy Head" width={1200} height={300} className="h-40 sm:h-56 md:h-72 object-contain w-auto cursor-pointer hover:opacity-80 transition-opacity" priority />
          </Link>
        </div>
        <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight text-blue-900 font-mono">About Happy Head</h1>
      <p className="text-xl text-gray-800">
        This project helps detect and track potentially concussive impacts by collecting event data
        (player, team, timestamp, and measured acceleration in g). The goal is to surface patterns
        and risk indicators that can support quicker sideline evaluations and longitudinal monitoring.
      </p>
      <section className="space-y-4">
        <h2 className="text-3xl font-bold text-blue-900">Our Mission</h2>
        <p className="text-lg text-gray-800">
          Happy Head is a modular IoT platform dedicated to the safety of the next generation of
          athletes. We believe that every play, every practice, and every season should be guided by
          clarity—not guesswork. By unifying sensor data, intuitive software, and responsible design,
          we transform raw impact signals into insight and action. Our mission is simple and profound:
          empower families, coaches, clinicians, and athletes themselves with timely, trustworthy
          information so that potential concussions are recognized early, recovery is respected, and
          futures remain bright.
        </p>
        <ul className="list-disc pl-6 text-lg text-gray-800 space-y-1">
          <li>
            <span className="font-semibold">Built to be modular:</span> integrates seamlessly with
            evolving hardware and team workflows.
          </li>
          <li>
            <span className="font-semibold">Built to be human:</span> places well‑being ahead of
            winning.
          </li>
          <li>
            <span className="font-semibold">Built to last:</span> a foundation upon which safer
            sports can stand.
          </li>
        </ul>
      </section>
      <section className="space-y-4">
        <h2 className="text-3xl font-bold text-blue-900">How to use the dashboard</h2>
        <ul className="list-disc pl-6 text-lg text-gray-800">
          <li>Filter by player, team, time range, and acceleration thresholds.</li>
          <li>Switch charts (histogram, bar, pie) to explore distributions and groupings.</li>
          <li>Open a player profile from the table to see individual history and stats.</li>
          <li>Export the current table or chart for sharing and analysis.</li>
        </ul>
      </section>
      <section className="space-y-4">
        <h2 className="text-3xl font-bold text-blue-900">Interpreting acceleration (g)</h2>
        <p className="text-lg text-gray-800">
          Acceleration magnitudes are bucketed as Mild (0–30g), Moderate (31–60g), and Dangerous (61g+)
          to provide an at-a-glance severity indicator. These are heuristics, not medical diagnoses.
          Always consult qualified professionals for clinical decisions.
        </p>
      </section>
      <section className="space-y-4">
        <h2 className="text-3xl font-bold text-blue-900">Privacy and data</h2>
        <p className="text-lg text-gray-800">
          Only essential event metrics are stored. If you have questions about data collection,
          accuracy, or retention, please reach out to the maintainers.
        </p>
      </section>
      </div>
    </>
  );
}


