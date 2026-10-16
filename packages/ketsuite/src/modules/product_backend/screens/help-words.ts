// The labels around every product screen's guide: the Help drawer, its trigger and its
// diagrams. Plain words, so a client bundle (a record modal's guide) can carry them too.

export const HELP = {
  vi: {
    label: 'Hướng dẫn',
    trigger: 'Hướng dẫn màn hình',
    close: 'Đóng hướng dẫn',
    diagram: 'Sơ đồ',
    table: 'Bảng',
    source: 'Mã sơ đồ',
    loading: 'Đang tải',
    error: 'Không thể tải sơ đồ',
  },
  en: {
    label: 'Help',
    trigger: 'Screen help',
    close: 'Close help',
    diagram: 'Diagram',
    table: 'Table',
    source: 'Diagram source',
    loading: 'Loading',
    error: 'Unable to load diagram',
  },
} as const
