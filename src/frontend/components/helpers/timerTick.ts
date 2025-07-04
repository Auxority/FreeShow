import { get } from "svelte/store"
import type { Event } from "../../../types/Calendar"
import { OUTPUT, STAGE } from "../../../types/Channels"
import { activeTimers, currentWindow, dictionary, events, nextActionEventPaused, nextActionEventStart, timers } from "../../stores"
import { newToast } from "../../utils/common"
import { translate } from "../../utils/language"
import { send } from "../../utils/request"
import { actionData } from "../actions/actionData"
import { customActionActivation, runAction } from "../actions/actions"
import { clone, keysToID, sortByTime } from "./array"
import { loadShows } from "./setShow"
import { checkNextAfterMedia } from "./showActions"
import { sortByClosestMatch } from "../actions/apiHelper"
import { getCurrentTimerValue, playPauseGlobal } from "../drawer/timers/timers"
import { getDynamicValue } from "../edit/scripts/itemHelpers"

const INTERVAL = 1000
const TEN_SECONDS = 1000 * 10
const ONE_MINUTE = 1000 * 60

let timeout: NodeJS.Timeout | null = null
let customInterval = INTERVAL
export function startTimer() {
    if (get(currentWindow)) return
    if (!get(activeTimers).filter((a) => a.paused !== true).length || timeout) return

    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
        const newActiveTimers = clone(get(activeTimers)).map(increment)

        send(OUTPUT, ["ACTIVE_TIMERS"], newActiveTimers)
        send(STAGE, ["ACTIVE_TIMERS"], newActiveTimers)
        activeTimers.set(newActiveTimers)

        timeout = null
        startTimer()
    }, customInterval)
}

export function startTimerByName(name: string) {
    if (name.includes("{")) name = getDynamicValue(name)
    const timersList = sortByClosestMatch(keysToID(get(timers)), name)
    const timerId = timersList[0]?.id
    if (!timerId) return

    startTimerById(timerId)
}

export function startTimerById(id: string) {
    const timer = get(timers)[id]
    if (!timer) return

    playPauseGlobal(id, timer, true)
}

export function stopTimers() {
    // timeout so timer_end action don't clear at the same time as next timer tick starts
    setTimeout(() => {
        // if (timeout) clearTimeout(timeout) // clear timeout (timer does not start again then...)
        activeTimers.set([])
        customInterval = INTERVAL
    }, 50)
}

function increment(timer: { id: string; start: number; end: number; [key: string]: any }, i: number) {
    if (!timer.paused && (timer.start < timer.end ? timer.currentTime >= timer.end && timer.currentTime < timer.end + 1 : timer.currentTime <= timer.end && timer.currentTime > timer.end - 1)) {
        if (!timer.overflow) timer.paused = true

        // ended
        checkNextAfterMedia(timer.id, "timer")
        customActionActivation(`timer_end___` + timer.id)
    }

    if ((timer.currentTime === timer.end && !timer.overflow) || timer.paused) return timer

    const currentTime = Date.now()
    // store timer start time (for accuracy)
    if (!timer.startTime) {
        const timerIs = timer.currentTime - timer.start
        const timerStartShouldBe = timerIs * 1000 // - 1
        if (timer.start < timer.end) timer.startTime = currentTime - timerStartShouldBe
        else timer.startTime = currentTime + timerStartShouldBe
    }

    const difference = currentTime - timer.startTime
    const timerShouldBe = Math.floor(difference / 1000) + 1

    // prevent interval time increasing more and more
    if (i === 0) {
        const preciseTime = (timerShouldBe - 1) * 1000
        const differenceMs = difference - preciseTime
        customInterval = Math.max(500, INTERVAL - differenceMs)
    }

    if (timer.start < timer.end) timer.currentTime = timer.start + timerShouldBe
    else timer.currentTime = timer.start - timerShouldBe

    return timer
}

// convert "show" to "action" <= 1.1.7
let initialized = false
function convertShowToAction() {
    if (initialized) return
    initialized = true

    let updated = false
    const allEvents = get(events)
    Object.keys(allEvents).forEach((eventId) => {
        const newEvent = allEvents[eventId]
        if (newEvent.type !== "show") return

        updated = true
        newEvent.type = "action"
        newEvent.action = { id: "start_show", data: { id: newEvent.show } }

        allEvents[eventId] = newEvent
    })

    if (updated) events.set(allEvents)
}

let actionTimeout: NodeJS.Timeout | null = null
export function startEventTimer() {
    if (actionTimeout) return

    convertShowToAction()

    const currentTime: Date = new Date()
    let actionEvents: Event[] = Object.values(get(events)).filter((a) => {
        const eventTime: Date = new Date(a.from)
        return a.type === "action" && currentTime.getTime() - INTERVAL < eventTime.getTime()
    })

    if (!actionEvents.length) nextActionEventStart.set({})

    actionEvents = actionEvents.sort(sortByTime)

    actionTimeout = setTimeout(() => {
        actionEvents.forEach((event, i) => {
            if (!event.action) return

            const eventTime: Date = new Date(event.from)
            const toast = get(dictionary).toast || {}
            if (get(nextActionEventPaused)) return

            const actionId = event.action.id
            const actionName = translate(actionData[actionId]?.name)

            const timeLeft: number = eventTime.getTime() - currentTime.getTime()
            if (i === 0) nextActionEventStart.set({ name: actionName, timeLeft })

            // less than 1 minute
            if (i < 4 && timeLeft <= ONE_MINUTE && timeLeft > ONE_MINUTE - INTERVAL) {
                newToast(`${toast.starting_action} "${actionName}" ${toast.less_than_minute}`)
                return
            }
            // less than 30 seconds
            if (i < 4 && timeLeft <= ONE_MINUTE / 2 && timeLeft > ONE_MINUTE / 2 - INTERVAL) {
                newToast(`${toast.starting_action} "${actionName}" ${toast.less_than_seconds.replace("{}", "30")}`)
                return
            }
            // less than 10 seconds
            if (i < 4 && timeLeft <= TEN_SECONDS && timeLeft > TEN_SECONDS - INTERVAL) {
                newToast(`${toast.starting_action} "${actionName}" ${toast.less_than_seconds.replace("{}", "10")}`)

                // preload data
                if (actionId === "start_show") loadShows([event.action.data?.id])
                return
            }

            // start action
            if (timeLeft <= 0 && timeLeft > 0 - INTERVAL) {
                newToast(`${toast.starting_action} "${actionName}" ${toast.now}`)

                runAction(convertEventAction(event.action))
            }
        })

        actionTimeout = null
        startEventTimer()
    }, INTERVAL)
}

function convertEventAction(action) {
    return { triggers: [action.id], actionValues: { [action.id]: action.data || {} } }
}

// TOWARDS A TIME/EVENT

let timerCheckTimeout: NodeJS.Timeout | null = null
export function checkTimers() {
    if (timerCheckTimeout) clearTimeout(timerCheckTimeout)

    Object.entries(get(timers)).forEach(([id, timer]) => {
        if (timer.type === "counter") return

        const time = getCurrentTimerValue({ ...timer, overflow: true }, {}, new Date())

        if (time < 0 && time >= -1) {
            checkNextAfterMedia(id, "timer")
            customActionActivation(`timer_end___` + id)
        }
    })

    timerCheckTimeout = setTimeout(() => {
        timerCheckTimeout = null
        checkTimers()
    }, 1000)
}
