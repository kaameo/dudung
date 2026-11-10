export type BroadcastStatus = 'READY' | 'LIVE' | 'ENDED';

export interface UserRef {
  id: string;
  nickname: string;
}

export interface Me extends UserRef {
  email: string;
}

export interface BroadcastItem {
  id: string;
  title: string;
  status: BroadcastStatus;
  source: 'SCREEN' | 'CAMERA' | null;
  owner: UserRef;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface BroadcastDetail extends Partial<BroadcastItem> {
  id: string;
  title: string;
  status: BroadcastStatus;
  owner: UserRef;
  isOwner: boolean;
  description?: string | null;
  pathName?: string;
  endReason?: string | null;
  viewerCount?: number;
  donationTotal?: number;
  recording?: { id: string; status: 'RECORDING' | 'PROCESSING' | 'READY' | 'FAILED' } | null;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CommentItem {
  id: string;
  broadcastId: string;
  body: string;
  author: UserRef;
  createdAt: string;
  edited: boolean;
}

export interface DonationItem {
  id: string;
  amount: number;
  message: string | null;
  donor: UserRef;
  approvedAt: string | null;
}

export interface RecordingItem {
  id: string;
  broadcastId: string;
  title: string;
  durationSec: number | null;
  owner: UserRef;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}
