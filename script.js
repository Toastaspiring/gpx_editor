document.addEventListener('DOMContentLoaded', () => {
    // --- Leaflet Map Initialization ---
    const map = L.map('map').setView([48.1173, -1.6778], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);

    // --- Global State ---
    let drawingPoints = [];
    let savedSections = {}; // { id: { name: "...", points: [...] } }
    let courseSequence = []; // Array of section IDs
    let drawingPolyline = L.polyline([], { color: 'orange', weight: 5, opacity: 0.8 }).addTo(map);
    let finalCoursePolyline = L.polyline([], { color: 'blue', weight: 5, opacity: 0.8 }).addTo(map);
    let drawingMarkers = L.layerGroup().addTo(map);
    let routingControl = null;

    // --- DOM Element References ---
    const exportButton = document.getElementById('export-button');
    const clearDrawingButton = document.getElementById('clear-drawing-button');
    const clearCourseButton = document.getElementById('clear-course-button');
    const saveSectionButton = document.getElementById('save-section-button');
    const sectionNameInput = document.getElementById('section-name-input');
    const sectionsListEl = document.getElementById('sections-list');
    const courseSequenceListEl = document.getElementById('course-sequence-list');
    const followRoadsToggle = document.getElementById('follow-roads-toggle');
    const undoButton = document.getElementById('undo-button');
    const drawingDistanceEl = document.getElementById('drawing-distance');
    const courseDistanceEl = document.getElementById('course-distance');
    const customModal = document.getElementById('custom-modal');
    const modalMessage = document.getElementById('modal-message');
    const modalCloseButton = document.getElementById('modal-close-button');
    const toggleSelectionModeButton = document.getElementById('toggle-selection-mode-button');
    const selectionActions = document.getElementById('selection-actions');
    const createSectionFromSelectionButton = document.getElementById('create-section-from-selection-button');
    const exitSelectionModeButton = document.getElementById('exit-selection-mode-button');

    // --- Selection Mode State ---
    let isSelectionMode = false;
    let selectedPoints = new Set();

    // --- Event Listeners ---
    map.on('click', handleMapClick);
    clearDrawingButton.addEventListener('click', clearCurrentDrawing);
    clearCourseButton.addEventListener('click', clearFinalCourse);
    saveSectionButton.addEventListener('click', saveSection);
    exportButton.addEventListener('click', exportGPX);
    followRoadsToggle.addEventListener('change', handleToggleChange);
    undoButton.addEventListener('click', undoLastPoint);
    modalCloseButton.addEventListener('click', () => customModal.classList.remove('visible'));
    toggleSelectionModeButton.addEventListener('click', enterSelectionMode);
    exitSelectionModeButton.addEventListener('click', exitSelectionMode);
    createSectionFromSelectionButton.addEventListener('click', createSectionFromSelection);

    // --- Selection Mode ---
    function enterSelectionMode() {
        if (drawingPoints.length < 2) {
            showModal("You need at least two points in your drawing to start selecting.");
            return;
        }
        isSelectionMode = true;
        toggleSelectionModeButton.classList.add('hidden');
        selectionActions.classList.remove('hidden');
        map.dragging.disable();
        showModal("Selection Mode Activated: Click on points to select them. Dragging is disabled.");

        // Update marker styles to show they are selectable
        drawingMarkers.eachLayer(marker => {
            marker.setOpacity(0.6);
        });
    }

    function exitSelectionMode() {
        isSelectionMode = false;
        selectedPoints.clear();
        toggleSelectionModeButton.classList.remove('hidden');
        selectionActions.classList.add('hidden');
        map.dragging.enable();

        // Restore original marker styles
        drawingMarkers.eachLayer(marker => {
            marker.setOpacity(1.0);
            // You might need to reset icons if you changed them
        });
    }

    function createSectionFromSelection() {
        if (selectedPoints.size < 2) {
            showModal("You must select at least two points to create a section.");
            return;
        }

        const selectionName = prompt("Please enter a name for your new section:", "Custom Selection");
        if (!selectionName) return; // User cancelled

        const newSectionPoints = Array.from(selectedPoints).sort((a, b) => a - b).map(index => drawingPoints[index]);

        const id = `section_${Date.now()}`;
        savedSections[id] = {
            id,
            name: selectionName,
            points: newSectionPoints,
            distance: calculateDistance(newSectionPoints)
        };

        renderSectionsList();
        exitSelectionMode(); // Exit selection mode after creation
    }

    // --- Utility Functions ---
    const showModal = (message) => {
        modalMessage.textContent = message;
        customModal.classList.add('visible');
    };

    const calculateDistance = (points) => {
        let totalDistance = 0;
        for (let i = 0; i < points.length - 1; i++) {
            const p1 = L.latLng(points[i].lat, points[i].lng);
            const p2 = L.latLng(points[i+1].lat, points[i+1].lng);
            totalDistance += p1.distanceTo(p2);
        }
        return (totalDistance / 1000).toFixed(2); // Convert to km
    };

    // --- Core Drawing & Routing Logic ---
    function handleToggleChange() {
        if (drawingPoints.length > 0) {
            const confirmed = confirm("Changing the routing mode will clear your current drawing. Are you sure?");
            if (confirmed) {
                clearCurrentDrawing();
            } else {
                followRoadsToggle.checked = !followRoadsToggle.checked; // Revert toggle
                return;
            }
        }
        if (followRoadsToggle.checked) {
            initializeRouting();
        } else if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }
    }

    function initializeRouting() {
        if (routingControl) map.removeControl(routingControl);
        routingControl = L.Routing.control({
            waypoints: [],
            routeWhileDragging: false,
            addWaypoints: false,
            createMarker: () => null,
            lineOptions: { styles: [{color: 'orange', opacity: 0.8, weight: 5}] }
        }).on('routesfound', (e) => {
            const route = e.routes[0];
            // Clear existing points and markers before adding new ones from the route
            drawingMarkers.clearLayers();
            drawingPoints = [];

            route.coordinates.forEach((coord, index) => {
                // For routes, we don't want individual markers, just the line.
                // We still need the points for saving the section.
                drawingPoints.push({ lat: coord.lat, lng: coord.lng, id: index });
            });

            // We also need to add markers for the waypoints only
            route.inputWaypoints.forEach(wp => {
                 L.marker(wp.latLng, { draggable: false }).addTo(drawingMarkers);
            });

            drawingPolyline.setLatLngs(route.coordinates.map(c => L.latLng(c.lat, c.lng)));
            drawingDistanceEl.textContent = `${(route.summary.totalDistance / 1000).toFixed(2)} km`;
        }).addTo(map);
    }

    function handleMapClick(e) {
        const latlng = e.latlng;
        // For manual drawing, add point directly
        if (!followRoadsToggle.checked) {
            addPoint(latlng);
        } else {
            // For road snapping, add a waypoint to the routing control
            if (!routingControl) initializeRouting();
            routingControl.spliceWaypoints(routingControl.getWaypoints().length, 0, latlng);
        }
    }

    function addPoint(latlng, index = -1) {
        const marker = L.marker(latlng, { draggable: true }).addTo(drawingMarkers);
        const pointIndex = (index === -1) ? drawingPoints.length : index;

        if (index === -1) {
            drawingPoints.push({ lat: latlng.lat, lng: latlng.lng, id: pointIndex });
        } else {
            drawingPoints.splice(index, 0, { lat: latlng.lat, lng: latlng.lng, id: pointIndex });
        }

        marker.on('dragend', (e) => {
            const newLatLng = e.target.getLatLng();
            const markerId = drawingMarkers.getLayers().indexOf(e.target);
            drawingPoints[markerId].lat = newLatLng.lat;
            drawingPoints[markerId].lng = newLatLng.lng;
            redrawDrawing();
        });

        marker.on('click', () => {
            const markerId = drawingMarkers.getLayers().indexOf(marker);
            if (isSelectionMode) {
                if (selectedPoints.has(markerId)) {
                    selectedPoints.delete(markerId);
                    marker.setOpacity(0.6); // Deselected style
                } else {
                    selectedPoints.add(markerId);
                    marker.setOpacity(1.0); // Selected style
                }
            } else {
                const deleteBtn = document.createElement('button');
                deleteBtn.innerHTML = 'Delete Point';
                deleteBtn.className = 'bg-red-500 text-white px-2 py-1 rounded-md hover:bg-red-600';
                deleteBtn.onclick = () => {
                    deletePoint(markerId);
                    map.closePopup();
                };

                const popupContent = document.createElement('div');
                popupContent.appendChild(deleteBtn);
                marker.bindPopup(popupContent).openPopup();
            }
        });

        redrawDrawing();
    }

    function deletePoint(index) {
        if (index < 0 || index >= drawingPoints.length) return;

        const markerToDelete = drawingMarkers.getLayers()[index];
        drawingMarkers.removeLayer(markerToDelete);
        drawingPoints.splice(index, 1);

        redrawDrawing();
    }

    function redrawDrawing() {
        // Redraw polyline
        const latLngs = drawingPoints.map(p => L.latLng(p.lat, p.lng));
        drawingPolyline.setLatLngs(latLngs);

        // Update distance
        drawingDistanceEl.textContent = `${calculateDistance(latLngs)} km`;

        // The markers themselves don't need redrawing, just the polyline connecting them
    }

    function undoLastPoint() {
        if (followRoadsToggle.checked && routingControl) {
            const waypoints = routingControl.getWaypoints();
            if (waypoints.length > 0) {
                routingControl.spliceWaypoints(waypoints.length - 1, 1);
                 // The routesfound event will handle the redraw
            }
        } else {
            // Manual drawing
            if (drawingPoints.length > 0) {
                deletePoint(drawingPoints.length - 1);
            }
        }
    }

    function clearCurrentDrawing() {
        drawingPoints = [];
        drawingPolyline.setLatLngs([]);
        drawingMarkers.clearLayers();
        if (routingControl) {
            routingControl.setWaypoints([]);
        }
        drawingDistanceEl.textContent = '0.00 km';
    }

    // --- Section Management ---
    function saveSection() {
        const name = sectionNameInput.value.trim();
        if (!name) return showModal("Please enter a name for the section.");
        if (drawingPoints.length < 2) return showModal("A section must have at least two points.");

        const id = `section_${Date.now()}`;
        savedSections[id] = {
            id,
            name,
            points: [...drawingPoints],
            distance: calculateDistance(drawingPoints)
        };

        renderSectionsList();
        clearCurrentDrawing();
        sectionNameInput.value = '';
    }

    function deleteSection(id) {
        if (courseSequence.includes(id)) {
            return showModal("This section is used in the final course. Please remove it from the course before deleting.");
        }
        delete savedSections[id];
        renderSectionsList();
    }

    // --- Course Building ---
    function rebuildFinalCourse() {
        let finalPoints = [];
        let totalDistance = 0;

        const courseSections = courseSequence.map(id => savedSections[id]);

        courseSections.forEach(section => {
            if (section) {
                finalPoints.push(...section.points);
                totalDistance += parseFloat(section.distance);
            }
        });

        const latLngs = finalPoints.map(p => L.latLng(p.lat, p.lng));
        finalCoursePolyline.setLatLngs(latLngs);
        courseDistanceEl.textContent = `Total: ${totalDistance.toFixed(2)} km`;
        renderCourseSequenceList();
    }

    function clearFinalCourse() {
        courseSequence = [];
        rebuildFinalCourse();
    }

    // --- UI Rendering ---
    function renderSectionsList() {
        sectionsListEl.innerHTML = '';
        if (Object.keys(savedSections).length === 0) {
            sectionsListEl.innerHTML = '<p class="text-slate-500 text-center p-4">Your saved sections will appear here. Drag them to the course builder below.</p>';
            return;
        }
        for (const id in savedSections) {
            const section = savedSections[id];
            const sectionEl = document.createElement('div');
            sectionEl.className = 'list-item flex items-center justify-between';
            sectionEl.dataset.id = id;
            sectionEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-slate-400 handle" viewBox="0 0 20 20" fill="currentColor"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                    <div>
                        <span class="font-medium text-slate-800">${section.name}</span>
                        <span class="text-xs text-slate-500 block">${section.distance} km &bull; ${section.points.length} points</span>
                    </div>
                </div>
                <button class="delete-section-btn text-red-500 hover:text-red-700 p-1" title="Delete Section">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                </button>
            `;
            sectionEl.querySelector('.delete-section-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteSection(id);
            });
            sectionsListEl.appendChild(sectionEl);
        }
    }

    function renderCourseSequenceList() {
        courseSequenceListEl.innerHTML = '';
        if (courseSequence.length === 0) {
            courseSequenceListEl.innerHTML = '<p class="text-slate-400 text-center self-center">Drop sections here</p>';
            return;
        }
        courseSequence.forEach((id, index) => {
            const section = savedSections[id];
            const courseItemEl = document.createElement('div');
            courseItemEl.className = 'list-item flex items-center justify-between';
            courseItemEl.dataset.id = id;
            courseItemEl.dataset.index = index;
            courseItemEl.innerHTML = `
                <div class="flex items-center gap-2">
                    <svg class="h-5 w-5 text-slate-500 handle" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" /></svg>
                    <span class="font-medium text-slate-800">${section.name}</span>
                </div>
                <div class="flex items-center">
                    <button class="reverse-course-item-btn text-blue-600 hover:text-blue-800 p-1" title="Reverse Direction">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M12.707 2.293a1 1 0 010 1.414L7.414 9H15a1 1 0 110 2H7.414l5.293 5.293a1 1 0 01-1.414 1.414l-7-7a1 1 0 010-1.414l7-7a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
                    </button>
                    <button class="remove-course-item-btn text-red-500 hover:text-red-700 p-1" title="Remove From Course">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" /></svg>
                    </button>
                </div>
            `;
            courseItemEl.querySelector('.remove-course-item-btn').addEventListener('click', () => {
                courseSequence.splice(index, 1);
                rebuildFinalCourse();
            });
            courseItemEl.querySelector('.reverse-course-item-btn').addEventListener('click', () => {
                const sectionToReverse = savedSections[id];
                sectionToReverse.points.reverse();
                // No distance change, just point order
                rebuildFinalCourse();
            });
            courseSequenceListEl.appendChild(courseItemEl);
        });
    }

    // --- Drag and Drop Initialization ---
    new Sortable(sectionsListEl, {
        group: { name: 'sections', pull: 'clone', put: false },
        sort: false,
        animation: 150,
        ghostClass: 'sortable-ghost',
    });

    new Sortable(courseSequenceListEl, {
        group: 'sections',
        animation: 150,
        ghostClass: 'sortable-ghost',
        handle: '.handle',
        onAdd: function (evt) {
            const id = evt.item.dataset.id;
            // A section might be reversed, so we need to create a unique instance for the course
            const originalSection = savedSections[id];
            const newId = `${id}_${Date.now()}`;
            savedSections[newId] = { ...originalSection, points: [...originalSection.points] }; // Deep copy points

            courseSequence.splice(evt.newDraggableIndex, 0, newId);
            rebuildFinalCourse();
            evt.item.remove(); // Remove the cloned item
        },
        onUpdate: function (evt) {
            const [movedItem] = courseSequence.splice(evt.oldDraggableIndex, 1);
            courseSequence.splice(evt.newDraggableIndex, 0, movedItem);
            rebuildFinalCourse();
        },
    });

    // --- GPX Export ---
    function generateGPXString() {
        let finalPoints = [];
        courseSequence.forEach(id => {
            const section = savedSections[id];
            if (section) finalPoints.push(...section.points);
        });

        const courseName = courseSequence.map(id => savedSections[id].name).join(' -> ');
        const isoTime = new Date().toISOString();

        let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GPX Track Builder" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
    <metadata>
        <name>${courseName || 'Custom Course'}</name>
        <time>${isoTime}</time>
    </metadata>
    <trk>
        <name>Combined Track</name>
        <trkseg>`;

        finalPoints.forEach(p => {
            gpxContent += `\n            <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lng.toFixed(6)}"><time>${isoTime}</time></trkpt>`;
        });
        gpxContent += `\n        </trkseg>
    </trk>
</gpx>`;
        return gpxContent;
    }

    function exportGPX() {
        if (courseSequence.length === 0) return showModal("Your course is empty. Add some sections before exporting.");

        const gpxData = generateGPXString();
        const blob = new Blob([gpxData], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gpx-course_${new Date().toISOString().slice(0,19).replace('T', '_').replace(/:/g, '-')}.gpx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- Initial UI Setup ---
    renderSectionsList();
    renderCourseSequenceList();
});
