window.workoutLibraryModal = function () {
  return {
    workoutData: {},
    searchQuery: '',
    filteredData: {},

    async init() {
      await this.loadWorkoutData()
    },

    async loadWorkoutData() {
      try {
        const response = await fetch('zwift_workouts.json')
        if (!response.ok) throw new Error('Failed to load workout data')
        this.workoutData = await response.json()
        this.filteredData = this.workoutData
      } catch (error) {
        console.error('Error loading workout data:', error)
        alert('Erreur lors du chargement de la bibliothèque des entraînements')
      }
    },

    get displayData() {
      return this.searchQuery ? this.filteredData : this.workoutData
    },

    prepareWorkoutData(item, itemName, collectionName, isSubItem = false) {
      return {
        name: item.name,
        duration: item.duration,
        description: item.description,
        author: item.author,
        showPath: isSubItem && !!this.searchQuery,
        path: isSubItem ? `${collectionName}/${itemName}` : null,
        onClick: () => {
          this.selectWorkout(item)
        }
      }
    },

    filterData() {
      if (!this.searchQuery.trim()) {
        this.filteredData = this.workoutData
        return
      }

      const query = this.searchQuery.toLowerCase()
      this.filteredData = this.createFilteredStructure(this.workoutData, query)
    },

    createFilteredStructure(data, query) {
      const filtered = {}

      for (const [key, value] of Object.entries(data)) {
        if (this.isWorkoutFile(value)) {
          if (this.matchesSearch(value, key, query)) filtered[key] = value
        } else if (typeof value === 'object') {
          const filteredCollection = this.createFilteredStructure(value, query)
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
      const success = await mainApp.loadWorkoutFromLibrary(workoutData.url)
      if (success) this.closeModal()
    },

    closeModal() {
      document.getElementById('libraryModal').close()
    }
  }
}
