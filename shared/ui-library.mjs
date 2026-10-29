// One OpenUI component vocabulary shared by the server (which serializes tool
// results to OpenUI Lang) and the browser (which renders them). Components are
// display-only: none of them can run code, open URLs or trigger tools.
import { z } from 'zod';

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export function buildLibrary({ createLibrary, defineComponent }, render = {}) {
  const make = (name, description, props) => defineComponent({ name, description, props, component: render[name] ?? null });
  const Text = make('Text', 'Paragraph of plain text.', z.object({ content: z.string() }));
  const Notice = make('Notice', 'Short highlighted note.', z.object({ tone: z.enum(['info', 'success', 'warning', 'error']), content: z.string() }));
  const Metrics = make('Metrics', 'Row of labelled values.', z.object({ items: z.array(z.object({ label: z.string(), value: z.string() })) }));
  const Table = make('Table', 'Data table.', z.object({ columns: z.array(z.string()), rows: z.array(z.array(cell)) }));
  const BarChart = make('BarChart', 'Horizontal bar chart of labelled numbers.', z.object({ title: z.string(), labels: z.array(z.string()), values: z.array(z.number()) }));
  const List = make('List', 'Bulleted list.', z.object({ items: z.array(z.string()) }));
  const Transcript = make('Transcript', 'Timed speech transcript.', z.object({ segments: z.array(z.object({ start: z.number().nullable(), end: z.number().nullable(), text: z.string() })) }));
  const Labels = make('Labels', 'Ranked labels with scores from 0 to 1.', z.object({ items: z.array(z.object({ label: z.string(), score: z.number() })) }));
  const Audio = make('Audio', 'Playable generated audio clip, referenced by id.', z.object({ ref: z.string(), seconds: z.number() }));
  const Code = make('Code', 'Preformatted text or JSON.', z.object({ content: z.string() }));
  const Steps = make('Steps', 'Ordered steps with status.', z.object({ items: z.array(z.object({ label: z.string(), status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']) })) }));
  const Image = make('Image', 'Generated or attached image, referenced by id.', z.object({ ref: z.string(), alt: z.string() }));
  const Download = make('Download', 'A saved file the user can download, referenced by id.', z.object({ ref: z.string(), name: z.string(), format: z.string() }));
  const blocks = [Text, Notice, Metrics, Table, BarChart, List, Transcript, Labels, Audio, Code, Steps, Image, Download];
  const Card = make('Card', 'Result card: a title, optional subtitle and a list of blocks.', z.object({ title: z.string(), subtitle: z.string().optional(), body: z.array(z.union(blocks.map(b => b.ref))) }));
  return createLibrary({ components: [Card, ...blocks], root: 'Card' });
}
