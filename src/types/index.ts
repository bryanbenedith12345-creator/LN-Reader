export interface BookRecord {
  id: string;
  title: string;
  author: string;
  series: string | null;
  file_path: string;
  cover_path: string | null;
  total_chapters: number;
  current_chapter: number;
  current_para_index: number;
  scroll_ratio: number;
  total_words: number;
  created_at: number;
  last_read_at: number;
}

export interface ChapterRecord {
  id: string;
  book_id: string;
  chapter_index: number;
  title: string;
  href: string;
  word_count: number;
}

export interface ProcessedChapter {
  chapter_index: number;
  title: string;
  content_html: string;
  word_count: number;
  illustrations: string[];
}

export interface BookmarkRecord {
  id: string;
  book_id: string;
  chapter_index: number;
  para_index: number;
  scroll_ratio: number;
  snippet: string;
  created_at: number;
}

export type ThemeMode = "washi" | "kinari" | "sumi" | "aizome";
export type FontFamily = "literata" | "newsreader" | "mincho" | "system";
export type LayoutMode = "paginated" | "scroll";
export type ColumnMode = "single" | "dual";
export type TextAlign = "justify" | "left";
export type SortOption = "last_read" | "title" | "author" | "progress" | "date_added";

export interface ReaderSettings {
  theme: ThemeMode;
  fontFamily: FontFamily;
  fontSize: number;       // 14 - 30 px
  lineHeight: number;     // 1.40 - 2.10
  maxWidth: number;       // 50 - 82 ch
  paraGap: number;        // 0.4 - 1.8 em
  margins: number;        // 24 - 96 px
  layoutMode: LayoutMode; // "paginated" | "scroll"
  columnMode: ColumnMode; // "single" | "dual"
  textAlign: TextAlign;   // "justify" | "left"
  showFurigana: boolean;  // true | false
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: "kinari",
  fontFamily: "literata",
  fontSize: 18,
  lineHeight: 1.75,
  maxWidth: 68,
  paraGap: 0.85,
  margins: 48,
  layoutMode: "paginated",
  columnMode: "dual",
  textAlign: "justify",
  showFurigana: true,
};
