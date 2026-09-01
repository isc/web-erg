import { formatDuration } from './utils.js'

/**
 * Where the library comes from. Two catalogues, one list: the Zwift workouts the app has always
 * shipped, and the Concept2 archive, which is the only machine-readable rowing corpus there is.
 * Each entry is stamped with the directory it lives under, so a workout knows how to be loaded
 * without the loader having to know which catalogue it came from.
 */
const CATALOGUES = [
  {
    manifest: 'zwift_workouts.json',
    root: 'zwift_workouts_all_collections_ordered_Mar21',
    machine: 'bike'
  },
  { manifest: 'rowing_workouts.json', root: 'rowing_workouts', machine: 'rower' }
]

function stampRoot(node, root) {
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue
    if ('url' in value) value.root = root
    else stampRoot(value, root)
  }
  return node
}

/**
 * The library is two catalogues merged, and a cycling session on a rower is not a session at all:
 * its cadence targets are in rpm, and the Concept2 archive is the reverse. Showing both regardless
 * of what is plugged in put eleven hundred bike workouts in front of a rower.
 *
 * The filter is over top-level collections, not over workouts. Which machine a session is for is a
 * property of the catalogue it came from, so it is constant across everything under a catalogue's
 * collections — walking to the leaves to ask would test the same answer fourteen hundred times, and
 * would have added a third way of recognising a leaf to a file that already disagrees with itself
 * about it twice (`'url' in value` here, `isWorkoutFile` below).
 *
 * Filtering only once a machine is actually connected, rather than defaulting to the bike: before a
 * connection the adapter descriptor is the bike's, so keying off it alone would hide the rowing
 * catalogue from anyone browsing before they connect — which is most of the time.
 */
function keepMachine(data, collectionMachines, machine) {
  return Object.fromEntries(
    Object.entries(data).filter(([name]) => collectionMachines[name] === machine)
  )
}

window.workoutLibraryModal = function () {
  return {
    formatDuration,
    workoutData: {},
    // Which machine each top-level collection is for, by collection name. Built at load, because
    // that is the only place the catalogue a collection came from is still known.
    collectionMachines: {},
    searchQuery: '',
    minDuration: '',
    maxDuration: '',
    filteredData: {},

    async init() {
      await this.loadWorkoutData()
    },

    async loadWorkoutData() {
      try {
        const catalogues = await Promise.all(
          CATALOGUES.map(async ({ manifest, root, machine }) => {
            const response = await fetch(manifest)
            if (!response.ok) throw new Error(`Failed to load ${manifest}`)
            return { machine, data: stampRoot(await response.json(), root) }
          })
        )
        for (const { machine, data } of catalogues)
          for (const name of Object.keys(data)) this.collectionMachines[name] = machine
        this.workoutData = Object.assign({}, ...catalogues.map(c => c.data))
        this.filteredData = this.workoutData
      } catch (error) {
        console.error('Error loading workout data:', error)
        alert('Could not load the workout library')
      }
    },

    // `ergometerName` and `ergometer` come from the app's scope, which this dialog sits inside.
    // Null until something is connected, which is exactly the "show everything" case.
    //
    // The adapter's own `kind` rather than a ternary on `rowing`: the descriptor already states
    // 'bike' or 'rower', which are the two values the catalogues are stamped with, so asking the
    // machine what it is beats deriving it back from a boolean that was derived from it. A third
    // adapter — the FTMS Rower firmware bluetooth.js already mentions — would otherwise be
    // classified 'bike' by the falsy branch and handed eleven hundred cycling workouts.
    get machine() {
      return this.ergometerName ? this.ergometer.kind : null
    },

    get displayData() {
      const data = this.hasActiveFilters ? this.filteredData : this.workoutData
      return this.machine ? keepMachine(data, this.collectionMachines, this.machine) : data
    },

    get hasActiveFilters() {
      return !!(this.searchQuery || this.minDuration || this.maxDuration)
    },

    prepareWorkoutData(item, itemName, collectionName, isSubItem = false) {
      return {
        name: item.name,
        duration: item.duration,
        description: item.description,
        author: item.author,
        showPath: isSubItem && this.hasActiveFilters,
        path: isSubItem ? `${collectionName}/${itemName}` : null,
        onClick: () => {
          this.selectWorkout(item)
        }
      }
    },

    filterData() {
      if (!this.hasActiveFilters) {
        this.filteredData = this.workoutData
        return
      }

      const query = this.searchQuery.toLowerCase()
      const minDuration = this.minDuration ? parseInt(this.minDuration) : 0
      const maxDuration = this.maxDuration
        ? parseInt(this.maxDuration)
        : Infinity

      this.filteredData = this.createFilteredStructure(
        this.workoutData,
        query,
        minDuration,
        maxDuration
      )
    },

    createFilteredStructure(data, query, minDuration, maxDuration) {
      const filtered = {}

      for (const [key, value] of Object.entries(data)) {
        if (this.isWorkoutFile(value)) {
          if (
            this.matchesSearch(value, key, query) &&
            this.matchesDuration(value, minDuration, maxDuration)
          ) {
            filtered[key] = value
          }
        } else if (typeof value === 'object') {
          const filteredCollection = this.createFilteredStructure(
            value,
            query,
            minDuration,
            maxDuration
          )
          if (Object.keys(filteredCollection).length > 0)
            filtered[key] = filteredCollection
        }
      }

      return filtered
    },

    isWorkoutFile(item) {
      return (
        item && typeof item === 'object' && 'name' in item && 'duration' in item
      )
    },

    matchesSearch(item, itemName, query) {
      const searchText = `${item.name} ${item.description || ''} ${
        item.author || ''
      }`.toLowerCase()
      return searchText.includes(query)
    },

    matchesDuration(item, minDuration, maxDuration) {
      return item.duration >= minDuration && item.duration <= maxDuration
    },

    getCollectionCount(collection) {
      return this.countWorkoutsRecursive(collection)
    },

    countWorkoutsRecursive(node) {
      let count = 0
      for (const value of Object.values(node)) {
        if (this.isWorkoutFile(value)) count += 1
        else if (typeof value === 'object')
          count += this.countWorkoutsRecursive(value)
      }
      return count
    },

    async selectWorkout(workoutData) {
      const mainContainer = document.querySelector('[x-data="workoutApp()"]')
      if (!mainContainer || !mainContainer._x_dataStack) {
        console.error('Could not find main Alpine component')
        return
      }
      const mainApp = mainContainer._x_dataStack[0]
      mainApp.selectedWorkout = workoutData
      const success = await mainApp.loadWorkoutFromLibrary(
        workoutData.url,
        workoutData.root
      )
      if (success) this.closeModal()
    },

    closeModal() {
      document.getElementById('libraryModal').close()
    }
  }
}
