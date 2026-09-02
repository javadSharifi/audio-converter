import { TrackListView } from "./TrackListView";

export function LikedView(): React.JSX.Element {
  return <TrackListView likedOnly={true} />;
}
