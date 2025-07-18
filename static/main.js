document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM cargado. Iniciando la aplicación.");

    // ====================
    // 1. REFERENCIAS AL DOM
    // ====================
    const refs = {
        main: document.querySelector('main'),
        readerView: document.getElementById('reader-view'),
        vocabView: document.getElementById('vocab-view'),
        navVocabBtn: document.getElementById('nav-vocab-btn'),
        navReaderBtn: document.getElementById('nav-reader-btn'),
        vocabStatusFilter: document.getElementById('vocab-status-filter'),
        vocabSearchInput: document.getElementById('vocab-search-input'),
        vocabTableBody: document.getElementById('vocab-table-body'),
        uploadSection: document.getElementById('upload-section'),
        resultSection: document.getElementById('result-section'),
        langSelect: document.getElementById('lang-select'),
        outputLangSelect: document.getElementById('output-lang-select'),
        loadingSpinner: document.getElementById('loading-spinner'),
        dropArea: document.getElementById('drop-area'),
        fileInput: document.getElementById('file-input'),
        textOutput: document.getElementById('text-output'),
        pageImage: document.getElementById('page-image-view'),
        pageLabel: document.getElementById('page-label'),
        prevBtn: document.getElementById('prev-btn'),
        nextBtn: document.getElementById('next-btn'),
        restartBtn: document.getElementById('restart-btn'),
        popupOverlay: document.getElementById('popup-overlay'),
        translationPopup: document.getElementById('translation-popup'),
        popupCloseBtn: document.getElementById('popup-close-btn'),
        popupWord: document.getElementById('popup-word'),
        popupTranslation: document.getElementById('popup-translation'),
        popupStatusButtons: document.getElementById('popup-status-buttons'),
        playBtn: document.getElementById('play-btn'),
        pauseBtn: document.getElementById('pause-btn'),
        stopBtn: document.getElementById('stop-btn')
    };

    // ========================
    // 2. VARIABLES DE ESTADO
    // ========================
    let state = {
        documentPages: [],
        currentPageIndex: 0,
        synth: window.speechSynthesis,
        currentUtterance: null,
        highlightedWord: null,
        wordSpans: []  // Almacena los spans de palabras para el TTS
    };

    // ====================
    // 3. FUNCIONES PRINCIPALES
    // ====================

    // --------------- Funciones de Utilidad ---------------
    const showToast = (message, type = 'info') => {
        const style = {
            background: type === 'error' 
                ? "linear-gradient(to right, #ff5f6d, #ffc371)" 
                : "linear-gradient(to right, #00b09b, #96c93d)"
        };
        Toastify({ 
            text: message, 
            duration: 3000, 
            close: true, 
            gravity: "top", 
            position: "right", 
            style, 
            stopOnFocus: true 
        }).showToast();
    };

    // -------------- Gestión de Vistas --------------
    const showReaderView = () => {
        refs.vocabView.classList.add('hidden');
        refs.readerView.classList.remove('hidden');
        refs.navVocabBtn.classList.remove('hidden');
        refs.main.classList.remove('main-expanded');
    };

    const showVocabularyView = async () => {
        refs.readerView.classList.add('hidden');
        refs.vocabView.classList.remove('hidden');
        refs.navVocabBtn.classList.add('hidden');
        refs.main.classList.add('main-expanded');
        await loadAndRenderVocabulary();
    };

    const showUploadView = () => {
        stopTTS();
        refs.resultSection.classList.add('hidden');
        refs.uploadSection.style.display = 'block';
        refs.loadingSpinner.classList.add('hidden');
        refs.dropArea.classList.remove('hidden');
        refs.fileInput.value = '';
        state.documentPages = [];
    };

    const updateView = async () => {
        if (state.documentPages.length === 0) return;
        
        stopTTS();
        const page = state.documentPages[state.currentPageIndex];
        await renderInteractiveText(page.text);
        
        refs.pageImage.src = `data:image/png;base64,${page.image_b64}`;
        refs.pageLabel.textContent = `Página ${state.currentPageIndex + 1} de ${state.documentPages.length}`;
        refs.prevBtn.disabled = state.currentPageIndex === 0;
        refs.nextBtn.disabled = state.currentPageIndex >= state.documentPages.length - 1;
    };

    // ----------- Inicialización -----------
    const populateVoiceList = () => {
        const voices = state.synth.getVoices();
        refs.langSelect.innerHTML = '';
        
        if (voices.length === 0 && refs.langSelect.options.length === 0) {
            refs.langSelect.innerHTML = '<option>No se encontraron voces</option>';
            return;
        }
        
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.textContent = `${voice.name} (${voice.lang})`;
            option.value = voice.lang;
            refs.langSelect.appendChild(option);
        });
    };

    const populateTranslationLanguages = async () => {
        try {
            const response = await fetch('/get_supported_languages');
            if (!response.ok) throw new Error(`Error del servidor: ${response.statusText}`);
            
            const languages = await response.json();
            refs.outputLangSelect.innerHTML = '';
            
            languages.forEach(lang => {
                const option = document.createElement('option');
                option.textContent = lang.name || lang.language;
                option.value = lang.language;
                refs.outputLangSelect.appendChild(option);
            });
            
            refs.outputLangSelect.value = 'es';
        } catch (e) {
            console.error("Error al cargar idiomas de traducción:", e);
            refs.outputLangSelect.innerHTML = '<option>Error al cargar</option>';
        }
    };

    // ----------- Procesamiento de Archivos -----------
    const handleFile = async (file) => {
        if (!file) return;
        
        refs.dropArea.classList.add('hidden');
        refs.loadingSpinner.classList.remove('hidden');
        
        const formData = new FormData();
        formData.append('file', file);
        formData.append('source_lang', refs.langSelect.value);
        
        try {
            const response = await fetch('/process', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) throw new Error(`Error del servidor: ${response.statusText}`);
            
            const data = await response.json();
            if (data.error) {
                showToast(`Error: ${data.error}`, 'error');
                showUploadView();
                return;
            }
            
            refs.uploadSection.style.display = 'none';
            refs.resultSection.classList.remove('hidden');
            state.documentPages = data.pages;
            state.currentPageIndex = 0;
            await updateView();
        } catch (e) {
            showToast(`Error de conexión: ${e.message}`, 'error');
            showUploadView();
        } finally {
            refs.loadingSpinner.classList.add('hidden');
            refs.dropArea.classList.remove('hidden');
        }
    };

    // ----------- Renderizado de Texto -----------
    const renderInteractiveText = async (text) => {
        refs.textOutput.innerHTML = '<div class="loader"></div>';
        const words = text.split(/[\s,.;:!?]+/).filter(Boolean).map(w => w.toLowerCase());
        const uniqueWords = [...new Set(words)];
        let wordStatuses = {};
        
        try {
            const response = await fetch('/get_vocabulary_status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    words: uniqueWords, 
                    target_lang: refs.outputLangSelect.value 
                })
            });
            
            if (response.ok) wordStatuses = await response.json();
        } catch (e) {
            console.error("No se pudo obtener el estado del vocabulario:", e);
        }
        
        refs.textOutput.innerHTML = '';
        const parts = text.split(/(\s+)/);
        state.wordSpans = [];  // Reiniciamos el array de spans
        
        parts.forEach(part => {
            const cleanPart = part.trim().toLowerCase().replace(/[.,:;!?]$/, '');
            
            if (cleanPart.length > 0) {
                const span = document.createElement('span');
                span.textContent = part;
                span.onclick = () => onWordClick(span);
                
                // Guardamos la referencia al span
                state.wordSpans.push(span);
                
                // Aplicar clases según estado
                const status = wordStatuses[cleanPart];
                if (status === 'aprendiendo') {
                    span.classList.add('word-learning');
                } else if (status === 'conocida') {
                    span.classList.add('word-known');
                } else {
                    // Si no está en la base de datos, se considera nueva
                    span.classList.add('word-new');
                }
                
                refs.textOutput.appendChild(span);
            } else {
                refs.textOutput.appendChild(document.createTextNode(part));
            }
        });
    };

    // ----------- Gestión de Vocabulario -----------
    const loadAndRenderVocabulary = async () => {
        const status = refs.vocabStatusFilter.value;
        refs.vocabTableBody.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;
        
        try {
            const response = await fetch(`/get_vocabulary?status=${status}`);
            const vocabulary = await response.json();
            refs.vocabTableBody.innerHTML = '';
            
            if (vocabulary.length === 0) {
                refs.vocabTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No hay palabras.</td></tr>`;
                return;
            }
            
            vocabulary.forEach(word => {
                const row = document.createElement('tr');
                row.dataset.word = word.word_text;
                row.dataset.lang = word.target_language;
                
                const statusClass = `status-${word.learning_status}`;
                row.innerHTML = `
                    <td>${word.word_text}</td>
                    <td>${word.translation}</td>
                    <td>${word.target_language.toUpperCase()}</td>
                    <td><span class="status-badge ${statusClass}">${word.learning_status}</span></td>
                    <td>
                        <button class="action-btn" data-action="edit">✏️</button>
                        <button class="action-btn" data-action="delete">🗑️</button>
                    </td>
                `;
                
                refs.vocabTableBody.appendChild(row);
            });
            
            filterVocabularyTable();
        } catch (e) {
            refs.vocabTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Error al cargar.</td></tr>`;
        }
    };

    const filterVocabularyTable = () => {
        const searchTerm = refs.vocabSearchInput.value.trim().toLowerCase();
        const hasSearchTerm = searchTerm.length > 0;
        
        refs.vocabTableBody.querySelectorAll('tr').forEach(row => {
            if (!row.cells[0] || !row.cells[1]) {
                row.style.display = 'none';
                return;
            }
            
            if (!hasSearchTerm) {
                row.style.display = '';
                return;
            }
            
            const wordText = row.cells[0].textContent.toLowerCase();
            const translationText = row.cells[1].textContent.toLowerCase();
            
            const shouldShow = wordText.includes(searchTerm) || 
                              translationText.includes(searchTerm);
            
            row.style.display = shouldShow ? '' : 'none';
        });
    };

    const handleTableActions = (event) => {
        const button = event.target.closest('.action-btn');
        if (!button) return;
        
        const action = button.dataset.action;
        const row = button.closest('tr');
        const word = row.dataset.word;
        const lang = row.dataset.lang;
        
        if (action === 'delete') {
            if (confirm(`¿Eliminar "${word}"?`)) {
                deleteWordFromDB(word, lang, row);
            }
        } else if (action === 'edit') {
            const currentTranslation = row.cells[1].textContent;
            const newTranslation = prompt(`Editar traducción para "${word}":`, currentTranslation);
            
            if (newTranslation && newTranslation !== currentTranslation) {
                editWordInDB(word, newTranslation, lang, row);
            }
        }
    };

    const deleteWordFromDB = async (word, lang, row) => {
        try {
            const response = await fetch('/delete_word', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    word, 
                    target_lang: lang 
                })
            });
            
            if (!response.ok) throw new Error('Error del servidor');
            row.remove();
            showToast(`'${word}' eliminada.`, 'info');
        } catch (e) {
            showToast('No se pudo eliminar la palabra.', 'error');
        }
    };

    const editWordInDB = async (word, newTranslation, lang, row) => {
        try {
            const response = await fetch('/edit_word', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    word, 
                    translation: newTranslation, 
                    target_lang: lang 
                })
            });
            
            if (!response.ok) throw new Error('Error del servidor');
            row.cells[1].textContent = newTranslation;
            showToast(`'${word}' actualizada.`, 'info');
        } catch (e) {
            showToast('No se pudo editar la palabra.', 'error');
        }
    };

    // ----------- Traducción y Popup -----------
    const onWordClick = async (spanElement) => {
        const cleanWord = spanElement.textContent.replace(/[.,:;!?]$/, '').trim().toLowerCase();
        if (!cleanWord) return;
        
        refs.popupStatusButtons.dataset.currentWord = cleanWord;
        refs.popupStatusButtons.dataset.currentSpanIndex = Array.from(
            refs.textOutput.querySelectorAll('span')
        ).indexOf(spanElement);
        
        showPopup('Traduciendo...');
        
        try {
            const response = await fetch('/translate', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    word: cleanWord, 
                    target_lang: refs.outputLangSelect.value 
                })
            });
            
            const data = await response.json();
            if (data.error) {
                updatePopupContent(`Error: ${data.error}`);
            } else {
                updatePopupContent(data.translation, cleanWord, data.status);
            }
        } catch (e) {
            updatePopupContent(`Error de red: ${e.message}`);
        }
    };

    const handleStatusChange = async (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        
        const newStatus = button.dataset.status;
        const word = refs.popupStatusButtons.dataset.currentWord;
        const spanIndex = parseInt(refs.popupStatusButtons.dataset.currentSpanIndex, 10);
        
        try {
            const response = await fetch('/update_word_status', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ 
                    word, 
                    target_lang: refs.outputLangSelect.value, 
                    status: newStatus 
                })
            });
            
            if (response.ok) {
                showToast(`'${word}' marcada como '${newStatus}'`, 'info');
                updateActiveButton(newStatus);
                updateWordSpanClass(spanIndex, newStatus);
            }
        } catch (e) {
            console.error("Error al actualizar el estado:", e);
        }
    };

    const showPopup = (content) => {
        updatePopupContent(content);
        refs.popupOverlay.classList.remove('hidden');
        refs.translationPopup.classList.remove('hidden');
    };

    const hidePopup = () => {
        refs.popupOverlay.classList.add('hidden');
        refs.translationPopup.classList.add('hidden');
    };

    const updatePopupContent = (translation, word = '', status = '') => {
        refs.popupWord.textContent = word;
        refs.popupTranslation.textContent = translation || 'N/A';
        if (status) updateActiveButton(status);
    };

    const updateActiveButton = (activeStatus) => {
        refs.popupStatusButtons.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.status === activeStatus);
        });
    };

    const updateWordSpanClass = (spanIndex, status) => {
        const span = refs.textOutput.querySelectorAll('span')[spanIndex];
        if (!span) return;
        
        // Limpiamos todas las clases de estado
        span.classList.remove('word-new', 'word-learning', 'word-known');
        
        // Aplicamos la clase correspondiente
        if (status === 'aprendiendo') {
            span.classList.add('word-learning');
        } else if (status === 'conocida') {
            span.classList.add('word-known');
        } else {
            span.classList.add('word-new');
        }
    };

    // ----------- Texto a Voz (TTS) -----------
    const highlightWord = (span) => {
        // Limpiar highlight anterior
        if (state.highlightedWord) {
            state.highlightedWord.classList.remove('highlight');
        }
        
        // Aplicar nuevo highlight
        span.classList.add('highlight');
        state.highlightedWord = span;
        
        // Scroll a la palabra
        span.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'nearest', 
            inline: 'center' 
        });
    };

    const playTTS = () => {
        if (state.synth.speaking && state.synth.paused) {
            state.synth.resume();
            return;
        }
        
        stopTTS();
        
        const textToSpeak = state.documentPages[state.currentPageIndex].text;
        state.currentUtterance = new SpeechSynthesisUtterance(textToSpeak);
        state.currentUtterance.lang = refs.langSelect.value;
        
        // Preparamos un array con los límites de cada palabra
        const wordBoundaries = [];
        let currentPosition = 0;
        
        // Recorremos los spans para calcular los límites
        state.wordSpans.forEach(span => {
            const word = span.textContent.trim();
            if (word) {
                wordBoundaries.push({
                    start: currentPosition,
                    end: currentPosition + word.length,
                    span: span
                });
                currentPosition += word.length + 1; // +1 por el espacio
            }
        });
        
        state.currentUtterance.onboundary = (event) => {
            if (event.name !== 'word') return;
            
            const charIndex = event.charIndex;
            // Buscamos el span que contiene este índice de carácter
            const currentWord = wordBoundaries.find(boundary => 
                charIndex >= boundary.start && charIndex < boundary.end
            );
            
            if (currentWord) {
                highlightWord(currentWord.span);
            }
        };
        
        state.currentUtterance.onend = () => {
            if (state.highlightedWord) {
                state.highlightedWord.classList.remove('highlight');
                state.highlightedWord = null;
            }
        };
        
        state.currentUtterance.onerror = (event) => {
            if (event.error !== 'canceled' && 
                event.error !== 'interrupted' && 
                event.error !== 'synthesis-cancelled') {
                console.error("Error TTS:", event.error);
                showToast("Error en el lector de audio.", "error");
            }
        };
        
        state.synth.speak(state.currentUtterance);
    };

    const pauseTTS = () => {
        if (state.synth.speaking && !state.synth.paused) {
            state.synth.pause();
        }
    };

    const stopTTS = () => {
        if (state.synth.speaking) {
            state.synth.cancel();
        }
        
        if (state.highlightedWord) {
            state.highlightedWord.classList.remove('highlight');
            state.highlightedWord = null;
        }
    };

    // ====================
    // 4. ASIGNACIÓN DE EVENTOS
    // ====================
    refs.navVocabBtn.onclick = showVocabularyView;
    refs.navReaderBtn.onclick = showReaderView;
    refs.fileInput.onchange = () => handleFile(refs.fileInput.files[0]);
    refs.dropArea.onclick = () => refs.fileInput.click();
    refs.dropArea.ondragover = (e) => {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    };
    refs.dropArea.ondragleave = (e) => {
        e.currentTarget.classList.remove('drag-over');
    };
    refs.dropArea.ondrop = (e) => {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        handleFile(e.dataTransfer.files[0]);
    };
    refs.prevBtn.onclick = async () => {
        if (state.currentPageIndex > 0) {
            state.currentPageIndex--;
            await updateView();
        }
    };
    refs.nextBtn.onclick = async () => {
        if (state.currentPageIndex < state.documentPages.length - 1) {
            state.currentPageIndex++;
            await updateView();
        }
    };
    refs.restartBtn.onclick = showUploadView;
    refs.vocabStatusFilter.onchange = loadAndRenderVocabulary;
    refs.vocabSearchInput.onkeyup = filterVocabularyTable;
    refs.vocabTableBody.onclick = handleTableActions;
    refs.popupCloseBtn.onclick = hidePopup;
    refs.popupOverlay.onclick = hidePopup;
    refs.popupStatusButtons.onclick = handleStatusChange;
    refs.playBtn.onclick = playTTS;
    refs.pauseBtn.onclick = pauseTTS;
    refs.stopBtn.onclick = stopTTS;

    // ====================
    // 5. INICIALIZACIÓN
    // ====================
    speechSynthesis.onvoiceschanged = populateVoiceList;
    populateVoiceList();
    populateTranslationLanguages();
});