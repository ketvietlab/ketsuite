// Tab-separated text, the format spreadsheets put on the clipboard. A cell holding a tab, a line
// break or a quote is quoted, with quotes doubled, so a copied note survives a round trip.

export const toTsv = (rows: readonly (readonly string[])[]): string =>
  rows
    .map((row) =>
      row.map((cell) => (/[\t\n\r"]/u.test(cell) ? `"${cell.replace(/"/gu, '""')}"` : cell)).join('\t'),
    )
    .join('\n')

export const fromTsv = (text: string): string[][] => {
  const source = text.replace(/\r\n?/gu, '\n')
  const input = source.endsWith('\n') ? source.slice(0, -1) : source
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let index = 0
  while (index < input.length) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"'
        index += 2
      } else if (char === '"') {
        quoted = false
        index += 1
      } else {
        cell += char
        index += 1
      }
    } else if (char === '"' && cell === '') {
      quoted = true
      index += 1
    } else if (char === '\t') {
      row.push(cell)
      cell = ''
      index += 1
    } else if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      index += 1
    } else {
      cell += char
      index += 1
    }
  }
  row.push(cell)
  rows.push(row)
  return rows
}
