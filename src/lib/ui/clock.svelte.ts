// A shared, lazily-started clock. Reading `clock.now` inside a component or effect
// subscribes it; the interval only runs while something is listening.

import { createSubscriber } from 'svelte/reactivity';

let current = Date.now();

const subscribe = createSubscriber((update) => {
	current = Date.now();
	update();
	const id = setInterval(() => {
		current = Date.now();
		update();
	}, 1000);
	return () => clearInterval(id);
});

export const clock = {
	get now(): number {
		subscribe();
		return current;
	}
};
