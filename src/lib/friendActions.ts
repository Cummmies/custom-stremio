// What you can do about another person, the same on their profile and on
// the Friends page: add, cancel a request, answer one, mark a close friend,
// unfriend and block (both asked once more first), unblock. Each runs, then
// calls `done` so the page can show the new state; a failure is said in a note.
import { lb } from '$lib/tracker/api';
import { menu, type MenuEntry } from '$lib/menu.svelte';

export type Person = { user_id: number; name: string; handle: string };
export type Done = (note?: string) => void;

const fail = (done: Done) => done('That didn’t work. Try again in a moment.');

/** Add a friend by handle; a note says what happened. */
export async function addFriend(handle: string, done: Done) {
    const res = await lb.addFriend(handle);
    if ('data' in res) return done(res.data.status === 'accepted' ? 'You’re now friends.' : 'Friend request sent.');
    done(
        res.status === 404
            ? 'No one has that username.'
            : res.status === 409
              ? 'You’re already friends, or you blocked them.'
              : res.status === 429
                ? 'You can’t send them another request yet.'
                : 'Couldn’t send the request. Try again in a moment.'
    );
}

export async function accept(friendshipId: number, done: Done) {
    (await lb.acceptFriend(friendshipId)) ? done() : fail(done);
}
export async function decline(friendshipId: number, done: Done) {
    (await lb.declineFriend(friendshipId)) ? done() : fail(done);
}
export async function cancelRequest(friendshipId: number, done: Done) {
    (await lb.cancelFriendRequest(friendshipId)) ? done() : fail(done);
}
export async function unblock(person: Person, done: Done) {
    (await lb.unblock(person.user_id)) ? done() : fail(done);
}

/** Asks once more before something that can't simply be taken back. */
function confirm(anchor: HTMLElement, header: string, detail: string, label: string, run: () => void) {
    menu.toggleFor(anchor, [{ header, detail }, { label, destructive: true, onselect: run }], 'end');
}

function blockEntry(anchor: HTMLElement, person: Person, done: Done): MenuEntry {
    return {
        label: 'Block…',
        icon: 'eyeOff',
        destructive: true,
        onselect: () =>
            confirm(anchor, `Block ${person.name}?`, 'They won’t be able to see your profile, find you, or send you requests. You stop being friends.', 'Block', async () =>
                (await lb.block(person.user_id)) ? done(`${person.name} is blocked.`) : fail(done)
            ),
    };
}

/** A friend's menu: Close Friend, Unfriend, Block. */
export function friendMenu(anchor: HTMLElement, person: Person & { close?: boolean }, done: Done) {
    menu.toggleFor(
        anchor,
        [
            {
                label: 'Close Friend',
                icon: 'star',
                checked: !!person.close,
                onselect: async () => ((await lb.setCloseFriend(person.user_id, !person.close)) ? done() : fail(done)),
            },
            { separator: true },
            {
                label: 'Unfriend…',
                icon: 'close',
                destructive: true,
                onselect: () =>
                    confirm(anchor, `Unfriend ${person.name}?`, 'You can send a request again later.', 'Unfriend', async () =>
                        (await lb.unfriend(person.user_id)) ? done() : fail(done)
                    ),
            },
            blockEntry(anchor, person, done),
        ],
        'end'
    );
}

/** Someone who isn't a friend: just Block. */
export function strangerMenu(anchor: HTMLElement, person: Person, done: Done) {
    menu.toggleFor(anchor, [blockEntry(anchor, person, done)], 'end');
}

/** A request you sent: Cancel Request. */
export function requestedMenu(anchor: HTMLElement, friendshipId: number, done: Done) {
    menu.toggleFor(anchor, [{ label: 'Cancel Request', icon: 'close', destructive: true, onselect: () => cancelRequest(friendshipId, done) }], 'end');
}
