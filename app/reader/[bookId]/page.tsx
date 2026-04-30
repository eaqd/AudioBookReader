import { Reader } from "@/components/Reader";

interface Params {
  bookId: string;
}

export default function ReaderPage({ params }: { params: Params }) {
  return <Reader bookId={params.bookId} />;
}
