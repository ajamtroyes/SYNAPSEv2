import { isSensitivePath } from './paths';

/** Rough but provider-independent. Real tokenizers differ per model and the agent must not depend on one. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const TEXT_EXTENSIONS =
  /\.(py|pyi|ts|tsx|js|jsx|mjs|cjs|go|rs|java|kt|rb|php|cs|c|h|cc|cpp|hpp|swift|scala|sh|md|mdx|rst|txt|toml|ya?ml|json|cfg|ini|html|css|sql)$/i;
const IGNORED_DIRECTORIES =
  /(^|\/)(\.git|node_modules|dist|build|out|target|vendor|coverage|__pycache__|\.venv|venv|\.tox|\.mypy_cache|\.pytest_cache|\.ruff_cache|\.next|\.idea|\.cache|\.nox)\//;
const LOCK_FILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|uv\.lock|poetry\.lock|Cargo\.lock|bun\.lock)$/;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CHUNK_LINES = 60;
const MIN_CHUNK_LINES = 4;

const STOPWORDS = new Set(
  (
    'a an and any are as at be been but by can could do does each else for from has have how if in into is it its ' +
    'like may must new no not of on one only or other our out over should so some such than that the their them ' +
    'then there these they this to up use used using was we were what when where which while who will with would you your'
  ).split(' '),
);

/** Enough stemming to match "commands" with "command" and "documented" with "document". */
function stem(term: string): string {
  if (term.length > 5 && term.endsWith('ing')) {
    return term.slice(0, -3);
  }
  if (term.length > 4 && term.endsWith('ed')) {
    return term.slice(0, -2);
  }
  if (term.length > 3 && term.endsWith('s') && !term.endsWith('ss')) {
    return term.slice(0, -1);
  }
  return term;
}

export function tokenize(text: string): string[] {
  const spaced = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[^A-Za-z0-9]+/g, ' ');
  const terms: string[] = [];
  for (const raw of spaced.toLowerCase().split(' ')) {
    if (raw.length >= 2 && !STOPWORDS.has(raw)) {
      terms.push(stem(raw));
    }
  }
  return terms;
}

const DEFINITION =
  /^\s*(?:export\s+|public\s+|private\s+|protected\s+|static\s+|default\s+|abstract\s+|async\s+|pub\s+)*(?:def|class|function|func|fn|interface|type|struct|enum|trait|impl)\s+([A-Za-z_][A-Za-z0-9_]*)/;
const TOP_LEVEL_CONST = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(/;
const MARKDOWN_HEADING = /^#{1,6}\s+(.+)$/;
const RST_UNDERLINE = /^(={3,}|-{3,}|~{3,}|\^{3,})\s*$/;

export interface SymbolDefinition {
  name: string;
  /** Zero-based. */
  line: number;
}

/** Regex over a language server: it must work in any workspace, with no setup, on any model. */
export function extractDefinitions(text: string): SymbolDefinition[] {
  const definitions: SymbolDefinition[] = [];
  for (const [line, value] of text.split('\n').entries()) {
    const name = DEFINITION.exec(value)?.[1] ?? TOP_LEVEL_CONST.exec(value)?.[1];
    if (name) {
      definitions.push({ name, line });
    }
  }
  return definitions;
}

interface Chunk {
  path: string;
  /** Zero-based, end exclusive. */
  start: number;
  end: number;
  text: string;
  symbols: string[];
  heading?: string;
  termCounts: Map<string, number>;
  length: number;
}

function isTopLevelBoundary(line: string): boolean {
  return /^\S/.test(line) && (DEFINITION.test(line) || TOP_LEVEL_CONST.test(line) || line.startsWith('@'));
}

const isMarkdown = (path: string): boolean => /\.mdx?$/i.test(path);
const isRst = (path: string): boolean => /\.(rst|txt)$/i.test(path);

/** File type decides the rules: "# text" is a heading in Markdown and a comment in Python. */
function chunkBoundaries(path: string, lines: readonly string[]): { start: number; heading?: string }[] {
  const boundaries: { start: number; heading?: string }[] = [{ start: 0 }];
  const add = (start: number, heading?: string): void => {
    // A very short span holds nothing useful alone, so it joins the chunk that follows it.
    const last = boundaries.at(-1);
    if (last && start - last.start < MIN_CHUNK_LINES) {
      if (heading) {
        last.heading = heading;
      }
      return;
    }
    boundaries.push(heading ? { start, heading } : { start });
  };
  for (const [index, line] of lines.entries()) {
    if (isMarkdown(path)) {
      const heading = MARKDOWN_HEADING.exec(line)?.[1];
      if (heading) {
        add(index, heading);
      }
    } else if (isRst(path)) {
      const title = (lines[index - 1] ?? '').trim();
      if (index > 0 && RST_UNDERLINE.test(line) && title !== '') {
        add(index - 1, title);
      }
    } else if (isTopLevelBoundary(line) && !(lines[index - 1] ?? '').startsWith('@')) {
      add(index);
    }
  }
  return boundaries;
}

function makeChunk(path: string, lines: readonly string[], start: number, end: number, heading?: string): Chunk {
  const text = lines.slice(start, end).join('\n');
  const termCounts = new Map<string, number>();
  const terms = tokenize(text);
  for (const term of terms) {
    termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
  }
  // A code sample in the docs does not define anything.
  const symbols = isMarkdown(path) || isRst(path) ? [] : extractDefinitions(text).map(definition => definition.name);
  return { path, start, end, text, symbols, termCounts, length: terms.length, ...(heading ? { heading } : {}) };
}

function chunkFile(path: string, text: string): Chunk[] {
  const lines = text.split('\n');
  const boundaries = chunkBoundaries(path, lines);
  const chunks: Chunk[] = [];
  for (const [index, boundary] of boundaries.entries()) {
    const stop = boundaries[index + 1]?.start ?? lines.length;
    for (let start = boundary.start; start < stop; start += MAX_CHUNK_LINES) {
      const end = Math.min(start + MAX_CHUNK_LINES, stop);
      if (lines.slice(start, end).join('').trim() !== '') {
        chunks.push(makeChunk(path, lines, start, end, boundary.heading));
      }
    }
  }
  return chunks;
}

export interface SelectedSnippet {
  path: string;
  /** One-based, inclusive. */
  startLine: number;
  endLine: number;
  tokens: number;
  score: number;
  reason: string;
  text: string;
}

export interface OmittedFile {
  path: string;
  score: number;
}

export interface RetrievalResult {
  query: string;
  budgetTokens: number;
  usedTokens: number;
  filesConsidered: number;
  snippets: SelectedSnippet[];
  /** Ranked just below the cut, so the agent knows where else it could look. */
  omitted: OmittedFile[];
}

export interface RetrievalOptions {
  budgetTokens: number;
  /** Paths already covered by explicit @-mentions. */
  excludePaths?: ReadonlySet<string>;
  /** Share of the budget one file may take, so one large file cannot crowd out a multi-file change. */
  maxFileShare?: number;
}

export interface RetrievalCorpus {
  listFiles(): Promise<string[]>;
  read(path: string): Promise<string | undefined>;
}

const BM25_K1 = 1.4;
const BM25_B = 0.6;
const SYMBOL_BOOST = 3;
const HEADING_BOOST = 2.5;
const PATH_BOOST = 30;
const PATH_REASON_THRESHOLD = 0.25;
const BEST_CHUNK_WEIGHT = 1;
const OTHER_CHUNK_WEIGHT = 0.15;
const COUNTED_CHUNKS = 4;
/** A companion of a top source file ranks just below it: it is what a complete change touches next. */
const COMPANION_SHARE = 0.9;
const COMPANION_SOURCES = 2;
/** A source file this far behind the leader is not strong enough to pull its tests and docs in. */
const COMPANION_MIN_SOURCE_SCORE = 0.5;
/**
 * "Be covered by a test" and "documented" say what a complete change includes, not where the code
 * is. As search terms they would rank every test file highly. Companion promotion serves that intent.
 */
const INTENT_TERMS = new Set(['test', 'unittest', 'doc', 'docs', 'document', 'documentation', 'cover', 'covered']);
/** Changelogs mention every feature ever added, so their matches say little about where code lives. */
const CHANGELOG = /(^|\/)(CHANGES|CHANGELOG|HISTORY|RELEASES?|NEWS)(\.[a-z]+)?$/i;
const CHANGELOG_PENALTY = 0.25;
/** A clipped snippet smaller than this cannot show the agent anything useful. */
const MIN_CLIPPED_TOKENS = 30;
const MAX_FILES = 10;
const TOKENS_PER_FILE = 500;

interface ScoredChunk {
  chunk: Chunk;
  score: number;
  matched: string[];
}

interface RankedFile {
  path: string;
  score: number;
  chunks: ScoredChunk[];
  pathMatches: string[];
  companionOf?: string;
}

function searchable(path: string): boolean {
  return (
    TEXT_EXTENSIONS.test(path) &&
    !IGNORED_DIRECTORIES.test(`/${path}`) &&
    !LOCK_FILES.test(path) &&
    !isSensitivePath(path)
  );
}

function scoreChunks(chunks: readonly Chunk[], queryTerms: readonly string[]): ScoredChunk[] {
  const documentFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    documentFrequency.set(term, chunks.filter(chunk => chunk.termCounts.has(term)).length);
  }
  const averageLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0) / Math.max(chunks.length, 1);
  const scored: ScoredChunk[] = [];
  for (const chunk of chunks) {
    let score = 0;
    const matched: string[] = [];
    const symbolTerms = new Set(chunk.symbols.flatMap(tokenize));
    const headingTerms = new Set(tokenize(chunk.heading ?? ''));
    for (const term of queryTerms) {
      const frequency = chunk.termCounts.get(term) ?? 0;
      if (frequency === 0) {
        continue;
      }
      matched.push(term);
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (chunks.length - df + 0.5) / (df + 0.5));
      const norm = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (chunk.length / Math.max(averageLength, 1)));
      let termScore = idf * ((frequency * (BM25_K1 + 1)) / norm);
      if (symbolTerms.has(term)) {
        termScore *= SYMBOL_BOOST;
      }
      if (headingTerms.has(term)) {
        termScore *= HEADING_BOOST;
      }
      score += termScore;
    }
    if (score > 0) {
      scored.push({ chunk, score, matched });
    }
  }
  return scored;
}

/**
 * How much a query term says when it appears in a path, from 0 to 1. In the Flask repository "flask"
 * and "test" appear in a large share of paths and say almost nothing, while "cli" appears in three.
 */
function pathTermWeights(paths: readonly string[], queryTerms: readonly string[]): Map<string, number> {
  const tokenized = paths.map(path => new Set(tokenize(path)));
  const scale = Math.log(1 + paths.length);
  const weights = new Map<string, number>();
  for (const term of queryTerms) {
    const frequency = tokenized.filter(tokens => tokens.has(term)).length;
    if (frequency > 0) {
      weights.set(term, (Math.log(1 + paths.length / frequency) / scale) ** 2);
    }
  }
  return weights;
}

function rankFiles(scored: readonly ScoredChunk[], allPaths: readonly string[], queryTerms: readonly string[]): RankedFile[] {
  const byPath = new Map<string, ScoredChunk[]>();
  for (const entry of scored) {
    const list = byPath.get(entry.chunk.path);
    if (list) {
      list.push(entry);
    } else {
      byPath.set(entry.chunk.path, [entry]);
    }
  }
  const weights = pathTermWeights(allPaths, queryTerms);
  const ranked: RankedFile[] = [];
  for (const [path, chunks] of byPath) {
    chunks.sort((a, b) => b.score - a.score);
    const matched = [...new Set(tokenize(path))].filter(term => weights.has(term));
    // Only the strongest chunks count, or a file would rank highly just for being long.
    const content = chunks
      .slice(0, COUNTED_CHUNKS)
      .reduce((sum, entry, index) => sum + entry.score * (index === 0 ? BEST_CHUNK_WEIGHT : OTHER_CHUNK_WEIGHT), 0);
    const pathScore = matched.reduce((sum, term) => sum + (weights.get(term) ?? 0) * PATH_BOOST, 0);
    ranked.push({
      path,
      chunks,
      // Only terms that actually discriminate are worth showing the user as a reason.
      pathMatches: matched.filter(term => (weights.get(term) ?? 0) >= PATH_REASON_THRESHOLD),
      score: (content + pathScore) * (CHANGELOG.test(path) ? CHANGELOG_PENALTY : 1),
    });
  }
  return ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

function stemOf(path: string): string {
  const name = path.split('/').at(-1) ?? path;
  return name.replace(/\.[^.]+$/, '');
}

/** Conventional test and doc locations for a source file. */
function companionPattern(sourcePath: string): RegExp | undefined {
  const stemName = stemOf(sourcePath)
    .replace(/^test_/, '')
    .replace(/\.(test|spec)$/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (stemName.length < 2 || stemName === 'index' || stemName === '__init__') {
    return undefined;
  }
  return new RegExp(
    `(^|/)((tests?|spec|__tests__)/(.*/)?(test_)?${stemName}(_test|\\.test|\\.spec)?\\.[a-z]+|` +
      `(docs?|documentation)/(.*/)?${stemName}\\.(md|mdx|rst|txt)|` +
      `${stemName}(\\.test|\\.spec|_test)\\.[a-z]+)$`,
    'i',
  );
}

/**
 * Lexical search finds the code a request names, but a change also needs the tests and docs that
 * travel with it, and those often share few words with the request. Pulling companions of the best
 * source files in is what lets a multi-file change be found without the user naming the files.
 */
function promoteCompanions(ranked: readonly RankedFile[]): RankedFile[] {
  const promoted: RankedFile[] = [];
  const isSource = (file: RankedFile): boolean =>
    !/(^|\/)(tests?|spec|__tests__|docs?|documentation|examples?)\//.test(file.path) && !/\.(md|mdx|rst|txt)$/i.test(file.path);
  const sources = ranked.filter(isSource);
  const leader = sources[0]?.score ?? 0;
  for (const source of sources.slice(0, COMPANION_SOURCES)) {
    const pattern = companionPattern(source.path);
    if (!pattern || source.score < leader * COMPANION_MIN_SOURCE_SCORE) {
      continue;
    }
    for (const candidate of ranked) {
      if (candidate.path !== source.path && pattern.test(candidate.path) && !promoted.some(file => file.path === candidate.path)) {
        // Placed directly below the source, even if it scored higher: the change starts at the source.
        promoted.push({ ...candidate, companionOf: source.path, score: source.score * COMPANION_SHARE });
      }
    }
  }
  const promotedPaths = new Set(promoted.map(file => file.path));
  return [...ranked.filter(file => !promotedPaths.has(file.path)), ...promoted].sort(
    (a, b) => b.score - a.score || a.path.localeCompare(b.path),
  );
}

/** Keeps whole lines from the top of a chunk that does not fit, or nothing if too little would be left. */
function clipToTokens(text: string, room: number): string | undefined {
  if (estimateTokens(text) <= room) {
    return text;
  }
  const kept: string[] = [];
  let length = 0;
  for (const value of text.split('\n')) {
    length += value.length + 1;
    if (Math.ceil(length / 4) > room) {
      break;
    }
    kept.push(value);
  }
  const clipped = kept.join('\n');
  return estimateTokens(clipped) >= MIN_CLIPPED_TOKENS ? clipped : undefined;
}

function explain(file: RankedFile, entry: ScoredChunk): string {
  const parts: string[] = [];
  if (file.companionOf) {
    parts.push(`companion of ${file.companionOf}`);
  }
  if (file.pathMatches.length > 0) {
    parts.push(`path matches ${file.pathMatches.join(', ')}`);
  }
  const symbolTerms = new Set(entry.matched);
  const namedSymbols = entry.chunk.symbols.filter(symbol => tokenize(symbol).some(term => symbolTerms.has(term)));
  if (namedSymbols.length > 0) {
    parts.push(`defines ${namedSymbols.slice(0, 3).join(', ')}`);
  }
  if (entry.chunk.heading) {
    parts.push(`section "${entry.chunk.heading}"`);
  }
  parts.push(`mentions ${[...new Set(entry.matched)].slice(0, 5).join(', ')}`);
  return parts.join('; ');
}

/** Ranks files for a query, then spends the budget breadth first, so several files always get in. */
export async function retrieve(
  corpus: RetrievalCorpus,
  query: string,
  options: RetrievalOptions,
): Promise<RetrievalResult> {
  const allTerms = [...new Set(tokenize(query))];
  const contentTerms = allTerms.filter(term => !INTENT_TERMS.has(term));
  const queryTerms = contentTerms.length > 0 ? contentTerms : allTerms;
  const excluded = options.excludePaths ?? new Set<string>();
  const paths = (await corpus.listFiles()).filter(searchable);
  const chunks: Chunk[] = [];
  for (const path of paths) {
    if (excluded.has(path)) {
      continue;
    }
    const text = await corpus.read(path);
    if (text !== undefined && text.length <= MAX_FILE_BYTES && !text.includes('\0')) {
      chunks.push(...chunkFile(path, text));
    }
  }

  const ranked = promoteCompanions(rankFiles(scoreChunks(chunks, queryTerms), paths, queryTerms));
  const fileCap = Math.floor(options.budgetTokens * (options.maxFileShare ?? 0.4));
  const spent = new Map<string, number>();
  const snippets: SelectedSnippet[] = [];
  let used = 0;

  const take = (file: RankedFile, entry: ScoredChunk, mayClip: boolean): boolean => {
    const room = Math.min(options.budgetTokens - used, fileCap - (spent.get(file.path) ?? 0));
    const fitted = mayClip ? clipToTokens(entry.chunk.text, room) : estimateTokens(entry.chunk.text) <= room ? entry.chunk.text : undefined;
    if (fitted === undefined) {
      return false;
    }
    const tokens = estimateTokens(fitted);
    used += tokens;
    spent.set(file.path, (spent.get(file.path) ?? 0) + tokens);
    snippets.push({
      path: file.path,
      startLine: entry.chunk.start + 1,
      endLine: entry.chunk.start + fitted.split('\n').length,
      tokens,
      score: Math.round(entry.score * 100) / 100,
      reason: explain(file, entry),
      text: fitted,
    });
    return true;
  };

  // Breadth first, over a limited number of files: the best chunk of each before a second chunk of
  // any. Only those first chunks may be clipped, since part of a top file beats none of it.
  const fileLimit = Math.max(3, Math.min(MAX_FILES, Math.floor(options.budgetTokens / TOKENS_PER_FILE)));
  const taken = new Set<ScoredChunk>();
  for (const file of ranked) {
    if (spent.size === fileLimit) {
      break;
    }
    const best = file.chunks[0];
    if (best && take(file, best, true)) {
      taken.add(best);
    }
  }
  // Then depth, in rounds that narrow to the top of the ranking: half the files, then a third, and so
  // on, so the file most likely to change gets the most. Chunk scores alone would favour many short
  // test functions over the code being changed.
  const queues = ranked
    .filter(file => spent.has(file.path))
    .map(file => ({ file, chunks: file.chunks.filter(entry => !taken.has(entry)) }));
  for (let round = 2; ; round += 1) {
    const open = queues.filter(queue => queue.chunks.length > 0);
    if (open.length === 0) {
      break;
    }
    for (const queue of open.slice(0, Math.ceil(open.length / round))) {
      const next = queue.chunks.shift();
      if (next) {
        take(queue.file, next, false);
      }
    }
  }

  const rank = new Map(ranked.map((file, index) => [file.path, index]));
  snippets.sort((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0) || a.startLine - b.startLine);
  return {
    query,
    budgetTokens: options.budgetTokens,
    usedTokens: used,
    filesConsidered: paths.length,
    snippets,
    omitted: ranked
      .filter(file => !spent.has(file.path))
      .slice(0, 10)
      .map(file => ({ path: file.path, score: Math.round(file.score * 100) / 100 })),
  };
}
