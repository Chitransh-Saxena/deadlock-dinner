export const CODE = {
  java: {
    naive: `import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.ThreadLocalRandom;

/*
 * NAIVE strategy ("Naïve (deadlock-prone)").
 *
 * Each philosopher picks up their LEFT fork first, then their RIGHT fork.
 * A "fork" is just a lock: only one philosopher can hold it at a time.
 *
 * THE BUG: if every philosopher grabs their left fork at the same moment,
 * everyone is now holding one fork and waiting forever for the right one.
 * Nobody can proceed -> classic DEADLOCK (a circular wait).
 */
public class NaiveDiningPhilosophers {

    static final int N = 5; // five philosophers, five forks around the table

    public static void main(String[] args) {
        // Each fork is a ReentrantLock. lock() = pick up, unlock() = put down.
        ReentrantLock[] forks = new ReentrantLock[N];
        for (int i = 0; i < N; i++) {
            forks[i] = new ReentrantLock();
        }

        // Start one thread per philosopher.
        for (int i = 0; i < N; i++) {
            final int id = i;
            new Thread(() -> philosopher(id, forks), "Philosopher-" + id).start();
        }
    }

    static void philosopher(int id, ReentrantLock[] forks) {
        // The fork on my left is forks[id]; the one on my right wraps around.
        ReentrantLock left = forks[id];
        ReentrantLock right = forks[(id + 1) % N];

        while (true) {
            think(id);

            // Pick up the LEFT fork first...
            left.lock();
            System.out.println("Philosopher " + id + " picked up LEFT fork");

            // !!! DEADLOCK WINDOW !!!
            // If every philosopher has reached this point, all left forks are
            // taken and the next line blocks forever for everyone.
            right.lock();
            System.out.println("Philosopher " + id + " picked up RIGHT fork");

            eat(id);

            // Always release in a finally-like manner so forks return to the table.
            right.unlock();
            left.unlock();
        }
    }

    static void think(int id) {
        System.out.println("Philosopher " + id + " is thinking");
        sleepRandom();
    }

    static void eat(int id) {
        System.out.println("Philosopher " + id + " is EATING");
        sleepRandom();
    }

    static void sleepRandom() {
        try {
            Thread.sleep(ThreadLocalRandom.current().nextInt(50, 200));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
`,
    hierarchy: `import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.ThreadLocalRandom;

/*
 * RESOURCE HIERARCHY strategy ("Resource Hierarchy").
 *
 * The forks are numbered 0..N-1. The rule: a philosopher ALWAYS picks up the
 * LOWER-numbered fork first, then the higher-numbered one.
 *
 * WHY THIS WORKS: deadlock needs a "circular wait" (a cycle of philosophers
 * each waiting on the next). By always acquiring locks in increasing order,
 * no such cycle can form. The last philosopher reaches for the lower number
 * first instead of completing the circle, so someone can always make progress.
 */
public class HierarchyDiningPhilosophers {

    static final int N = 5;

    public static void main(String[] args) {
        ReentrantLock[] forks = new ReentrantLock[N];
        for (int i = 0; i < N; i++) {
            forks[i] = new ReentrantLock();
        }

        for (int i = 0; i < N; i++) {
            final int id = i;
            new Thread(() -> philosopher(id, forks), "Philosopher-" + id).start();
        }
    }

    static void philosopher(int id, ReentrantLock[] forks) {
        int leftIndex = id;
        int rightIndex = (id + 1) % N;

        // Decide which fork is "first" purely by its NUMBER, not by side.
        int firstIndex = Math.min(leftIndex, rightIndex);
        int secondIndex = Math.max(leftIndex, rightIndex);

        ReentrantLock first = forks[firstIndex];
        ReentrantLock second = forks[secondIndex];

        while (true) {
            think(id);

            // Always lock the lower-numbered fork before the higher-numbered one.
            first.lock();
            second.lock();

            eat(id);

            second.unlock();
            first.unlock();
        }
    }

    static void think(int id) {
        System.out.println("Philosopher " + id + " is thinking");
        sleepRandom();
    }

    static void eat(int id) {
        System.out.println("Philosopher " + id + " is EATING");
        sleepRandom();
    }

    static void sleepRandom() {
        try {
            Thread.sleep(ThreadLocalRandom.current().nextInt(50, 200));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
`,
    waiter: `import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.ThreadLocalRandom;

/*
 * ARBITRATOR (WAITER) strategy ("Arbitrator (Waiter)").
 *
 * A single central "waiter" controls access to the forks. Before touching any
 * fork, a philosopher must ask the waiter for permission. The waiter is just
 * one shared lock, so only ONE philosopher may be picking up forks at a time.
 *
 * WHY THIS WORKS: a philosopher grabs BOTH forks while holding the waiter lock,
 * and only sits down to eat once both are in hand. Nobody ever holds one fork
 * while waiting for another, so the "hold and wait" condition for deadlock is
 * eliminated.
 */
public class WaiterDiningPhilosophers {

    static final int N = 5;

    // The waiter: a single shared lock everyone must go through.
    static final ReentrantLock waiter = new ReentrantLock();

    public static void main(String[] args) {
        ReentrantLock[] forks = new ReentrantLock[N];
        for (int i = 0; i < N; i++) {
            forks[i] = new ReentrantLock();
        }

        for (int i = 0; i < N; i++) {
            final int id = i;
            new Thread(() -> philosopher(id, forks), "Philosopher-" + id).start();
        }
    }

    static void philosopher(int id, ReentrantLock[] forks) {
        ReentrantLock left = forks[id];
        ReentrantLock right = forks[(id + 1) % N];

        while (true) {
            think(id);

            // Ask the waiter for permission. Only one philosopher passes here at a time.
            waiter.lock();
            try {
                // Take BOTH forks while we still hold the waiter lock.
                left.lock();
                right.lock();
            } finally {
                // Release the waiter immediately so others can request forks too.
                waiter.unlock();
            }

            eat(id);

            right.unlock();
            left.unlock();
        }
    }

    static void think(int id) {
        System.out.println("Philosopher " + id + " is thinking");
        sleepRandom();
    }

    static void eat(int id) {
        System.out.println("Philosopher " + id + " is EATING");
        sleepRandom();
    }

    static void sleepRandom() {
        try {
            Thread.sleep(ThreadLocalRandom.current().nextInt(50, 200));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
`,
    semaphore: `import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadLocalRandom;

/*
 * LIMITED SEATS (SEMAPHORE) strategy ("Limited Seats (Semaphore)").
 *
 * A counting semaphore is like a tray of N-1 dining tickets. To sit down and
 * attempt to eat, a philosopher must first acquire() a ticket; when done they
 * release() it. With only N-1 tickets, at most N-1 philosophers compete for
 * forks at once.
 *
 * WHY THIS WORKS: a full circular wait needs ALL N philosophers holding a fork
 * simultaneously. If at most N-1 are ever seated, at least one fork is always
 * free for someone, so the cycle can never close -> no deadlock.
 */
public class SemaphoreDiningPhilosophers {

    static final int N = 5;

    // Counting semaphore with N-1 permits: at most N-1 philosophers seated.
    static final Semaphore seats = new Semaphore(N - 1);

    public static void main(String[] args) {
        ReentrantLock[] forks = new ReentrantLock[N];
        for (int i = 0; i < N; i++) {
            forks[i] = new ReentrantLock();
        }

        for (int i = 0; i < N; i++) {
            final int id = i;
            new Thread(() -> philosopher(id, forks), "Philosopher-" + id).start();
        }
    }

    static void philosopher(int id, ReentrantLock[] forks) {
        ReentrantLock left = forks[id];
        ReentrantLock right = forks[(id + 1) % N];

        while (true) {
            think(id);

            try {
                // Take a seat. Blocks if all N-1 seats are currently taken.
                seats.acquire();

                left.lock();
                right.lock();

                eat(id);

                right.unlock();
                left.unlock();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            } finally {
                // Give the seat back so another philosopher may sit.
                seats.release();
            }
        }
    }

    static void think(int id) {
        System.out.println("Philosopher " + id + " is thinking");
        sleepRandom();
    }

    static void eat(int id) {
        System.out.println("Philosopher " + id + " is EATING");
        sleepRandom();
    }

    static void sleepRandom() {
        try {
            Thread.sleep(ThreadLocalRandom.current().nextInt(50, 200));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
`,
  },
  go: {
    naive: `package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// NAIVE strategy ("Naïve (deadlock-prone)").
//
// Each philosopher locks their LEFT fork first, then their RIGHT fork.
// A fork is a sync.Mutex: Lock() = pick up, Unlock() = put down. Only one
// goroutine can hold a given mutex at a time.
//
// THE BUG: if all five goroutines lock their left fork at the same instant,
// every fork is held and every philosopher blocks forever on the right fork.
// That is a classic DEADLOCK (a circular wait around the table).

const N = 5 // five philosophers, five forks

func main() {
	var forks [N]sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < N; i++ {
		wg.Add(1)
		go philosopher(i, &forks, &wg)
	}
	wg.Wait() // (in the deadlocking case, we never get past here)
}

func philosopher(id int, forks *[N]sync.Mutex, wg *sync.WaitGroup) {
	defer wg.Done()

	left := &forks[id]
	right := &forks[(id+1)%N]

	for {
		think(id)

		// Pick up the LEFT fork first...
		left.Lock()
		fmt.Printf("Philosopher %d picked up LEFT fork\\n", id)

		// !!! DEADLOCK WINDOW !!!
		// If everyone holds their left fork, this line blocks forever.
		right.Lock()
		fmt.Printf("Philosopher %d picked up RIGHT fork\\n", id)

		eat(id)

		right.Unlock()
		left.Unlock()
	}
}

func think(id int) {
	fmt.Printf("Philosopher %d is thinking\\n", id)
	sleepRandom()
}

func eat(id int) {
	fmt.Printf("Philosopher %d is EATING\\n", id)
	sleepRandom()
}

func sleepRandom() {
	time.Sleep(time.Duration(50+rand.Intn(150)) * time.Millisecond)
}
`,
    hierarchy: `package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// RESOURCE HIERARCHY strategy ("Resource Hierarchy").
//
// Forks are numbered 0..N-1. Rule: a philosopher ALWAYS locks the
// LOWER-numbered fork first, then the higher-numbered one.
//
// WHY THIS WORKS: deadlock requires a "circular wait" of philosophers each
// waiting on the next. Acquiring mutexes in a fixed global order (by number)
// makes such a cycle impossible, so the table can never freeze.

const N = 5

func main() {
	var forks [N]sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < N; i++ {
		wg.Add(1)
		go philosopher(i, &forks, &wg)
	}
	wg.Wait()
}

func philosopher(id int, forks *[N]sync.Mutex, wg *sync.WaitGroup) {
	defer wg.Done()

	leftIdx := id
	rightIdx := (id + 1) % N

	// Order the two forks by NUMBER, not by side.
	firstIdx, secondIdx := leftIdx, rightIdx
	if firstIdx > secondIdx {
		firstIdx, secondIdx = secondIdx, firstIdx
	}
	first := &forks[firstIdx]
	second := &forks[secondIdx]

	for {
		think(id)

		// Always lock the lower-numbered fork before the higher-numbered one.
		first.Lock()
		second.Lock()

		eat(id)

		second.Unlock()
		first.Unlock()
	}
}

func think(id int) {
	fmt.Printf("Philosopher %d is thinking\\n", id)
	sleepRandom()
}

func eat(id int) {
	fmt.Printf("Philosopher %d is EATING\\n", id)
	sleepRandom()
}

func sleepRandom() {
	time.Sleep(time.Duration(50+rand.Intn(150)) * time.Millisecond)
}
`,
    waiter: `package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// ARBITRATOR (WAITER) strategy ("Arbitrator (Waiter)").
//
// A single shared mutex acts as the "waiter". Before touching any fork, a
// philosopher must Lock() the waiter. Because only one goroutine can hold the
// waiter at a time, only one philosopher picks up forks at any moment.
//
// WHY THIS WORKS: a philosopher grabs BOTH forks while holding the waiter, so
// nobody ever holds one fork while waiting for another. That removes the
// "hold and wait" condition required for deadlock.

const N = 5

// The waiter: a single shared mutex everyone must pass through.
var waiter sync.Mutex

func main() {
	var forks [N]sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < N; i++ {
		wg.Add(1)
		go philosopher(i, &forks, &wg)
	}
	wg.Wait()
}

func philosopher(id int, forks *[N]sync.Mutex, wg *sync.WaitGroup) {
	defer wg.Done()

	left := &forks[id]
	right := &forks[(id+1)%N]

	for {
		think(id)

		// Ask the waiter for permission, then take BOTH forks before releasing it.
		waiter.Lock()
		left.Lock()
		right.Lock()
		waiter.Unlock() // others may now request forks too

		eat(id)

		right.Unlock()
		left.Unlock()
	}
}

func think(id int) {
	fmt.Printf("Philosopher %d is thinking\\n", id)
	sleepRandom()
}

func eat(id int) {
	fmt.Printf("Philosopher %d is EATING\\n", id)
	sleepRandom()
}

func sleepRandom() {
	time.Sleep(time.Duration(50+rand.Intn(150)) * time.Millisecond)
}
`,
    semaphore: `package main

import (
	"fmt"
	"math/rand"
	"sync"
	"time"
)

// LIMITED SEATS (SEMAPHORE) strategy ("Limited Seats (Semaphore)").
//
// In Go, a buffered channel makes a great counting semaphore: its capacity is
// the number of available "seats". Sending into it = take a seat (blocks when
// full); receiving from it = free a seat. We give it capacity N-1.
//
// WHY THIS WORKS: a full circular wait needs all N philosophers holding a fork
// at once. If at most N-1 are ever seated, at least one fork is always free for
// someone, so the deadlock cycle can never close.

const N = 5

// Buffered channel of capacity N-1 used as a counting semaphore.
var seats = make(chan struct{}, N-1)

func main() {
	var forks [N]sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < N; i++ {
		wg.Add(1)
		go philosopher(i, &forks, &wg)
	}
	wg.Wait()
}

func philosopher(id int, forks *[N]sync.Mutex, wg *sync.WaitGroup) {
	defer wg.Done()

	left := &forks[id]
	right := &forks[(id+1)%N]

	for {
		think(id)

		seats <- struct{}{} // take a seat (blocks if all N-1 are taken)

		left.Lock()
		right.Lock()

		eat(id)

		right.Unlock()
		left.Unlock()

		<-seats // give the seat back
	}
}

func think(id int) {
	fmt.Printf("Philosopher %d is thinking\\n", id)
	sleepRandom()
}

func eat(id int) {
	fmt.Printf("Philosopher %d is EATING\\n", id)
	sleepRandom()
}

func sleepRandom() {
	time.Sleep(time.Duration(50+rand.Intn(150)) * time.Millisecond)
}
`,
  },
};
