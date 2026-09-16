/**
 * BandwidthTracker
 * High-precision network and entity traffic diagnostics for Gauntlet Runtime.
 * Adapted from donor mechanism concepts without adopting donor semantics.
 * Implements REQ-DONOR-005 and REQ-OBS-001.
 */

export interface BandwidthUsage {
  sent: number;
  received: number;
  lastUpdatedMs: number;
}

export interface PeerBandwidthSummary {
  peerId: string;
  sent: number;
  received: number;
  totalBytes: number;
}

export class BandwidthTracker {
  private readonly sent = new Map<string, number>();
  private readonly received = new Map<string, number>();
  private readonly timestamps = new Map<string, number>();
  private totalSent = 0;
  private totalReceived = 0;

  /**
   * Records outbound bytes transmitted to a specific peer or channel.
   */
  public recordSent(peerId: string, bytes: number): void {
    const current = this.sent.get(peerId) ?? 0;
    this.sent.set(peerId, current + bytes);
    this.totalSent += bytes;
    this.timestamps.set(peerId, performance.now());
  }

  /**
   * Records inbound bytes received from a specific peer or channel.
   */
  public recordReceived(peerId: string, bytes: number): void {
    const current = this.received.get(peerId) ?? 0;
    this.received.set(peerId, current + bytes);
    this.totalReceived += bytes;
    this.timestamps.set(peerId, performance.now());
  }

  /**
   * Retrieves current bandwidth usage for a specific peer.
   */
  public getBandwidthUsage(peerId: string): BandwidthUsage {
    return {
      sent: this.sent.get(peerId) ?? 0,
      received: this.received.get(peerId) ?? 0,
      lastUpdatedMs: this.timestamps.get(peerId) ?? 0,
    };
  }

  /**
   * Retrieves aggregate bandwidth usage across all tracked peers.
   */
  public getTotalUsage(): { sent: number; received: number; total: number } {
    return {
      sent: this.totalSent,
      received: this.totalReceived,
      total: this.totalSent + this.totalReceived,
    };
  }

  /**
   * Returns a list of all active peer bandwidth summaries.
   */
  public getPeerSummaries(): PeerBandwidthSummary[] {
    const peerIds = new Set([...this.sent.keys(), ...this.received.keys()]);
    const summaries: PeerBandwidthSummary[] = [];

    for (const peerId of peerIds) {
      const sent = this.sent.get(peerId) ?? 0;
      const received = this.received.get(peerId) ?? 0;
      summaries.push({
        peerId,
        sent,
        received,
        totalBytes: sent + received,
      });
    }

    return summaries.sort((a, b) => b.totalBytes - a.totalBytes);
  }

  /**
   * Resets all tracked counters.
   */
  public reset(): void {
    this.sent.clear();
    this.received.clear();
    this.timestamps.clear();
    this.totalSent = 0;
    this.totalReceived = 0;
  }
}
