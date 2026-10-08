/**
 * FAQ — §4.13
 * Native <details>/<summary> accordion for free keyboard + screen-reader
 * accessibility. Each item is a white card with a hairline border.
 * The chevron indicator rotates when the details element is open via
 * the CSS `group-open:` modifier.
 * Items with an `id` can be deep-linked (#id); the target opens automatically.
 */
import { useEffect } from 'react';
import { faqItems } from '../data/faq';
import CopyCommand from './CopyCommand';

/** Open the <details> named by the URL hash (on load and on in-page links). */
function useOpenHashTarget() {
  useEffect(() => {
    const open = () => {
      const id = window.location.hash.slice(1);
      if (!id) return;
      const el = document.getElementById(id);
      if (el instanceof HTMLDetailsElement) {
        el.open = true;
        el.scrollIntoView({ block: 'start' });
      }
    };
    open();
    window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
}

export default function FAQ() {
  useOpenHashTarget();

  return (
    <section id="faq" className="py-20">
      <div className="mx-auto max-w-[720px] px-6">
        {/* Section title */}
        <h2 className="mb-12 text-center text-heading font-bold text-midnight-navy max-md:text-heading-sm">
          Questions, answered
        </h2>

        {/* Accordion items */}
        <div className="flex flex-col gap-3">
          {faqItems.map((item) => (
            <details
              key={item.question}
              id={item.id}
              className="group scroll-mt-24 rounded-cards border border-mist-border bg-paper shadow-sm"
            >
              {/* Question row */}
              <summary
                className={[
                  'flex cursor-pointer list-none items-center justify-between gap-4 px-6 py-5',
                  'text-body-sm font-semibold text-midnight-navy',
                  /* Remove default disclosure marker across browsers */
                  '[&::-webkit-details-marker]:hidden',
                ].join(' ')}
              >
                <span>{item.question}</span>

                {/* Chevron — rotates 180° when open */}
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 text-steel-blue transition-transform duration-200 group-open:rotate-180"
                  aria-hidden
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </summary>

              {/* Answer */}
              <div className="px-6 pb-6 text-body-sm text-slate-blue">
                <p>{item.answer}</p>
                {item.steps && (
                  <ol className="mt-3 list-decimal space-y-1.5 pl-5">
                    {item.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
                {item.command && (
                  <div className="mt-4">
                    <p className="mb-2">{item.command.intro}</p>
                    <CopyCommand label="$" command={item.command.text} />
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
