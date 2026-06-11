/**
 * HowItWorks — §4.10
 * Three numbered step cards explaining the two-minute setup flow.
 * Cards are horizontal on desktop, stacked on mobile.
 */

interface Step {
  number: string;
  title: string;
  description: React.ReactNode;
}

const steps: Step[] = [
  {
    number: '1',
    title: 'Download & launch',
    description: 'One installer, no account, no sign-up.',
  },
  {
    number: '2',
    title: 'Install hooks',
    description:
      'Open Settings, flip a switch per tool. Agent Pulse writes the hook config for you — and removes it just as cleanly.',
  },
  {
    number: '3',
    title: 'Keep working',
    description: (
      <>
        Bubbles appear as agents report in to a local bridge on{' '}
        <code className="rounded bg-fog px-1.5 py-0.5 font-mono text-micro text-midnight-navy">
          localhost:4242
        </code>
        . That&apos;s it.
      </>
    ),
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20">
      <div className="mx-auto max-w-[1200px] px-6">
        {/* Centered section title */}
        <h2 className="mb-12 text-center text-heading font-bold text-midnight-navy">
          Running in two minutes
        </h2>

        {/* Step cards — 3 columns desktop, 1 column mobile */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.number}
              className="rounded-cards border border-mist-border bg-paper p-8 shadow-sm"
            >
              {/* Big step number */}
              <div
                className="mb-4 font-bold leading-none text-midnight-navy"
                style={{ fontSize: '50px' }}
              >
                {step.number}
              </div>

              {/* Step title */}
              <h3 className="mb-3 text-body-sm font-semibold text-midnight-navy">
                {step.title}
              </h3>

              {/* Step description */}
              <p className="text-body-sm leading-relaxed text-slate-blue">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
