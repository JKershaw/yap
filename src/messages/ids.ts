/**
 * Allocates the next message id for a channel and advances the counter.
 * The counter lives on the channel so ids are monotonic per channel and
 * never reused, even after messages fall out of the ring buffer.
 */
export function nextId(state: { next_id: number }): number {
  const id = state.next_id;
  state.next_id = id + 1;
  return id;
}
