/**
 * Seed data for the fixture back-office. Every name and balance is obviously
 * fake, because the brief forbids real data and a reviewer must see that at a
 * glance.
 */

export interface Account {
  readonly id: string;
  readonly kind: string;
  readonly balance: string;
  readonly hold: boolean;
}

export interface Member {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly accounts: readonly Account[];
  /** Behaviour this member forces, so a test can drive it without a fault flag. */
  readonly quirk?: 'validation' | 'interstitial';
}

const MEMBERS: readonly Member[] = [
  {
    id: '100001',
    name: 'AVA FAKENAME',
    status: 'Active',
    accounts: [
      { id: 'S-01', kind: 'Savings', balance: '$4,182.55', hold: false },
      { id: 'C-01', kind: 'Checking', balance: '$912.10', hold: false },
    ],
  },
  {
    id: '100002',
    name: 'BEN NOTREAL',
    status: 'Active',
    quirk: 'validation',
    accounts: [{ id: 'S-01', kind: 'Savings', balance: '$77.00', hold: false }],
  },
  {
    id: '100003',
    name: 'CAM SAMPLE',
    status: 'Active',
    quirk: 'interstitial',
    accounts: [{ id: 'S-01', kind: 'Savings', balance: '$1,020.00', hold: false }],
  },
];

export function findMember(id: string): Member | undefined {
  return MEMBERS.find((m) => m.id === id.trim());
}

export function findAccount(member: Member, acct: string): Account | undefined {
  return member.accounts.find((a) => a.id === acct);
}

export function allMembers(): readonly Member[] {
  return MEMBERS;
}
