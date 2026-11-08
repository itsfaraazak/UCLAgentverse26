'use client';

import type { ReactNode } from 'react';
import { BookOpen, Info } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface GlossaryEntry {
  readonly term: string;
  readonly long?: string;
  readonly text: string;
}

export const GLOSSARY: Readonly<Record<string, GlossaryEntry>> = {
  PVS1: {
    term: 'PVS1',
    long: 'Pathogenic, very strong',
    text: 'The change destroys the protein (a “null” variant) in a gene where losing one working copy is known to cause disease.',
  },
  PS1: {
    term: 'PS1',
    long: 'Pathogenic, strong',
    text: 'It produces the same protein change as a variant already proven to cause disease.',
  },
  PM2: {
    term: 'PM2',
    long: 'Pathogenic, moderate',
    text: 'The variant is absent or extremely rare in large databases of healthy people.',
  },
  PP3: {
    term: 'PP3',
    long: 'Pathogenic, supporting',
    text: 'Computer predictors (here AlphaMissense) say the change is likely to damage the protein.',
  },
  PP1: {
    term: 'PP1',
    long: 'Pathogenic, supporting',
    text: 'In an affected family, the variant is passed down together with the disease.',
  },
  BA1: {
    term: 'BA1',
    long: 'Benign, stand-alone',
    text: 'It is too common in the general population (over 5%) to cause a rare disease. This alone makes it benign.',
  },
  BS1: {
    term: 'BS1',
    long: 'Benign, strong',
    text: 'It is more common in the population than the disease it would cause, so it is unlikely to be the cause.',
  },
  BP4: {
    term: 'BP4',
    long: 'Benign, supporting',
    text: 'Computer predictors say the change is likely to be harmless to the protein.',
  },
  ACMG: {
    term: 'ACMG',
    long: 'American College of Medical Genetics',
    text: 'The standard framework clinical labs use: each piece of evidence meets a named criterion worth points, and the total decides one of five classes.',
  },
  gnomAD: {
    term: 'gnomAD',
    long: 'Genome Aggregation Database',
    text: 'DNA from hundreds of thousands of people. Used to see how common a variant is in the general population: common variants rarely cause rare diseases.',
  },
  AlphaMissense: {
    term: 'AlphaMissense',
    long: 'Google DeepMind, 2023',
    text: 'A model that scores every possible single amino-acid change in human proteins from 0 (likely harmless) to 1 (likely damaging). Below 0.34 is likely benign, above 0.564 likely pathogenic.',
  },
  ClinVar: {
    term: 'ClinVar',
    long: 'NIH public archive',
    text: 'Where clinical labs publish how they classified a variant. Here it is the reference answer, held back until the agent has classified on its own.',
  },
  CADD: {
    term: 'CADD',
    long: 'Combined Annotation Dependent Depletion',
    text: 'A general “how damaging” score. Above 20 means the change is in the top 1% most damaging possible changes.',
  },
  VUS: {
    term: 'VUS',
    long: 'Variant of Uncertain Significance',
    text: 'Not enough evidence either way. A VUS must not be used to make a clinical decision.',
  },
  Pathogenic: {
    term: 'Pathogenic',
    text: 'Disease-causing, with enough evidence to act on clinically (for example, offering screening or surgery).',
  },
  HGVS: {
    term: 'HGVS',
    text: 'The standard notation for a DNA change (c. = coding DNA) or protein change (p. = protein).',
  },
  rsID: {
    term: 'rsID',
    text: 'A stable public name for a known variant position, from the dbSNP database (e.g. rs334).',
  },
  Stars: {
    term: 'Review stars',
    text: 'ClinVar’s 0–4 confidence rating: more stars means more independent labs or an expert panel agree.',
  },
};

export interface TermProps {
  /** Glossary key. */
  readonly k: string;
  readonly children?: ReactNode;
  readonly iconOnly?: boolean;
}

/** A term with a click-to-open plain-English definition. */
export function Term({ k, children, iconOnly }: TermProps) {
  const entry = GLOSSARY[k];
  if (!entry) return <>{children ?? k}</>;
  return (
    <Popover>
      <PopoverTrigger
        className={iconOnly ? 'wb-term wb-term--icon' : 'wb-term'}
        aria-label={iconOnly ? `What is ${entry.term}?` : undefined}
      >
        {iconOnly ? <Info className="size-3" aria-hidden="true" /> : (children ?? entry.term)}
      </PopoverTrigger>
      <PopoverContent side="top" className="wb-gloss">
        <GlossaryItem entry={entry} />
      </PopoverContent>
    </Popover>
  );
}

function GlossaryItem({ entry }: { readonly entry: GlossaryEntry }) {
  return (
    <div className="wb-gloss__item">
      <p className="wb-gloss__term">
        {entry.term}
        {entry.long && <span className="wb-gloss__long">{entry.long}</span>}
      </p>
      <p className="wb-gloss__text">{entry.text}</p>
    </div>
  );
}

const GROUPS: readonly { readonly title: string; readonly keys: readonly string[] }[] = [
  { title: 'Classes', keys: ['Pathogenic', 'VUS', 'ACMG'] },
  { title: 'Evidence sources', keys: ['gnomAD', 'AlphaMissense', 'ClinVar', 'CADD', 'Stars'] },
  { title: 'ACMG criteria', keys: ['PVS1', 'PS1', 'PM2', 'PP3', 'PP1', 'BA1', 'BS1', 'BP4'] },
  { title: 'Notation', keys: ['HGVS', 'rsID'] },
];

/** The full glossary, opened from the header. */
export function GlossaryButton() {
  return (
    <Popover>
      <PopoverTrigger className="wb-chrome-btn">
        <BookOpen className="size-3.5" aria-hidden="true" />
        <span>Glossary</span>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="wb-gloss wb-gloss--full">
        <p className="wb-gloss__intro">
          Plain-English definitions for the terms on screen. Click any dotted-underlined term for the same help in place.
        </p>
        {GROUPS.map((group) => (
          <section key={group.title} className="wb-gloss__group">
            <h3 className="wb-gloss__group-title">{group.title}</h3>
            {group.keys.map((k) => (
              <GlossaryItem key={k} entry={GLOSSARY[k]} />
            ))}
          </section>
        ))}
      </PopoverContent>
    </Popover>
  );
}
