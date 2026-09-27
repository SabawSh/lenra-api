/** Per-clip token ids (`token-0`, …) collide after merge — prefix with source part id. */
export function scopePartTokenId(partId: string, tokenId: string): string {
  return `${partId}::${tokenId}`;
}

export function scopePuzzlePartId(partId: string, puzzlePartId: string): string {
  return `${partId}::${puzzlePartId}`;
}
