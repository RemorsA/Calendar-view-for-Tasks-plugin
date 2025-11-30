import { App, Editor, ItemView, MarkdownRenderer, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, moment } from 'obsidian';
import { t, Language } from './locales';
import { CreateTaskButtonSettings, DEFAULT_SETTINGS, Task } from './types';

const COLOR_PRESETS = [
	{ name: 'Banana Cream', value: '#EEDCA7' },
	{ name: 'Deep Blueberry', value: '#2D3E56' },
	{ name: 'Warm Caramel', value: '#E7993F' },
	{ name: 'Iced Mint', value: '#AAC6AD' },
	{ name: 'Dark Chocolate', value: '#422B21' },
	{ name: 'Vanilla Chocolate', value: '#DFCFBA' }
];

function getContrastYIQ(hexcolor: string) {
	if (!hexcolor || !hexcolor.startsWith('#')) return 'var(--text-on-accent)';
	hexcolor = hexcolor.replace('#', '');
	const r = parseInt(hexcolor.substr(0,2),16);
	const g = parseInt(hexcolor.substr(2,2),16);
	const b = parseInt(hexcolor.substr(4,2),16);
	const yiq = ((r*299)+(g*587)+(b*114))/1000;
	// If light background (high YIQ), use dark text. Else use light text.
	// In Obsidian, text-normal is usually dark in light mode, light in dark mode.
	// We need explicit black/white or careful variable usage.
	// If light background (high YIQ), use dark text. Else use light text.
	// In Obsidian, text-normal is usually dark in light mode, light in dark mode.
	// We need explicit black/white or careful variable usage.
	return (yiq >= 128) ? '#000000' : '#ffffff';
}

export default class CreateTaskButtonPlugin extends Plugin {
	settings: CreateTaskButtonSettings;
	private isFirstLaunch: boolean = false;

	async onload() {
		await this.loadSettings();

		// Add settings tab
		this.addSettingTab(new CreateTaskButtonSettingTab(this.app, this));

		// Register calendar view
		this.registerView(
			'task-calendar-view',
			(leaf) => new TaskCalendarView(leaf, this)
		);

		// Add command to open calendar
		this.addCommand({
			id: 'open-task-calendar',
			name: t(this.settings.language, 'openTaskCalendar'),
			callback: () => {
				this.openCalendarView();
			}
		});

		// Auto-open calendar on app startup if enabled
		if (this.settings.autoOpenCalendar) {
			this.app.workspace.onLayoutReady(() => {
				this.isFirstLaunch = true;
				this.openCalendarView();
			});
		}

		// Add command that can be triggered anywhere
		this.addCommand({
			id: 'create-task',
			name: t(this.settings.language, 'createTask'),
			callback: async () => {
				await this.createTask();
			}
		});

		// Add editor command
		this.addCommand({
			id: 'create-task-in-editor',
			name: t(this.settings.language, 'createTaskInEditor'),
			editorCallback: async (editor: Editor, _view: MarkdownView) => {
				await this.insertTask(editor);
			}
		});
	}

	onunload() {
	}

	async createTask(date?: Date) {
		await this.insertTask(undefined, date);
	}

	private async insertTask(_editor?: Editor, date?: Date) {
		// Access plugins using type assertion
		const plugins = (this.app as any).plugins;
		const tasksPlugin = plugins?.plugins?.['obsidian-tasks-plugin'];
		
		if (!tasksPlugin?.apiV1) {
			new Notice(t(this.settings.language, 'tasksPluginNotFound'));
			return;
		}

		const tasksApi = tasksPlugin.apiV1;
		
		// Prepare date string if provided
		let dateStr = '';
		if (date) {
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			dateStr = `${year}-${month}-${day}`;
		}
		
		// Try different ways to pass date to the modal
		let taskLine: string | null = null;
		
		// Method 1: Try passing initial task line with date in due:: format
		if (dateStr) {
			try {
				const initialTask = `- [ ] due::${dateStr} `;
				if (tasksApi.createTaskLineModal.length > 0) {
					taskLine = await (tasksApi.createTaskLineModal as any)(initialTask);
				}
			} catch (e) {
				// Fall through to default method
			}
		}
		
		// Method 2: Try passing date as parameter object
		if (!taskLine && dateStr) {
			try {
				if (typeof (tasksApi.createTaskLineModal as any) === 'function') {
					const result = await (tasksApi.createTaskLineModal as any)({ 
						initialValue: `- [ ] due::${dateStr} `,
						dueDate: dateStr,
						date: dateStr
					});
					if (result) taskLine = result;
				}
			} catch (e) {
				// Fall through to default method
			}
		}
		
		// Method 3: Default - call without parameters
		if (!taskLine) {
			taskLine = await tasksApi.createTaskLineModal();
		}
		
		if (!taskLine) {
			// User cancelled the modal
			return;
		}

		// Add date to task if provided and not already present
		let finalTaskLine = taskLine;
		if (date) {
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			const dateStr = `${year}-${month}-${day}`;
			
			// Check if task already has a date (due, start, scheduled, or calendar emoji)
			const hasDate = taskLine.match(/due::|due:|start::|start:|scheduled::|scheduled:|📅/i);
			if (!hasDate) {
				finalTaskLine = taskLine.trim() + ' due::' + dateStr;
			}
		}

		// Determine target file date
		let targetDate = date;
		const extractedDate = this.extractDateFromText(finalTaskLine);
		if (extractedDate) {
			targetDate = extractedDate;
		}
		
		if (!targetDate) {
			targetDate = new Date();
		}

		// Use file with name YYYY-MM.md based on target date
		const targetFile = await this.getOrCreateMonthlyNote(targetDate);

		if (!targetFile) {
			new Notice(t(this.settings.language, 'failedToCreateOrAccessNote'));
			return;
		}

		// Get current content
		const content = await this.app.vault.read(targetFile);
		
		// Add task at the end of the file
		const trimmedContent = content.trimEnd();
		const taskText = finalTaskLine.endsWith('\n') ? finalTaskLine.trimEnd() : finalTaskLine;
		const separator = trimmedContent.length > 0 ? '\n' : '';
		const newContent = trimmedContent + separator + taskText + '\n';

		// Write updated content
		await this.app.vault.modify(targetFile, newContent);

		new Notice(t(this.settings.language, 'taskAddedSuccessfully'));
	}

	private extractDateFromText(text: string): Date | null {
		// Try various date formats from Tasks plugin
		// Format: 📅 YYYY-MM-DD or due::YYYY-MM-DD or start::YYYY-MM-DD or scheduled::YYYY-MM-DD
		const patterns = [
			/(?:📅|due::|due:|start::|start:|scheduled::|scheduled:)\s*(\d{4}-\d{2}-\d{2})/i,
			/(\d{4}-\d{2}-\d{2})/, // Any YYYY-MM-DD format
			/(\d{1,2}\/\d{1,2}\/\d{4})/, // DD/MM/YYYY
			/(\d{1,2}\.\d{1,2}\.\d{4})/, // DD.MM.YYYY
		];
		
		for (const pattern of patterns) {
			const match = text.match(pattern);
			if (match) {
				const dateStr = match[1];
				const date = new Date(dateStr);
				if (!isNaN(date.getTime())) {
					date.setHours(0, 0, 0, 0);
					return date;
				}
			}
		}
		
		return null;
	}

	private getDateHeader(date: Date): string {
		return moment(date).format(this.settings.filenameFormat || 'YYYY-MM');
	}

	private async getOrCreateMonthlyNote(date: Date): Promise<TFile | null> {
		const dateHeader = this.getDateHeader(date);
		const fileName = `${dateHeader}.md`;
		
		// Use createTaskFolderPath, fallback to tasksFolderPath for backward compatibility
		const folderPathSetting = this.settings.createTaskFolderPath || this.settings.tasksFolderPath || '';
		
		// Build file path with folder if specified
		let filePath = fileName;
		if (folderPathSetting.trim()) {
			const folderPath = folderPathSetting.trim().replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes
			filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
		}
		
		// Check if file already exists
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (existingFile instanceof TFile) {
			return existingFile;
		}

		// Create folder if it doesn't exist and path is specified
		if (folderPathSetting.trim()) {
			const folderPath = folderPathSetting.trim().replace(/^\/+|\/+$/g, '');
			if (folderPath) {
				const folder = this.app.vault.getAbstractFileByPath(folderPath);
				if (!folder) {
					try {
						await this.app.vault.createFolder(folderPath);
					} catch (error) {
						console.error('Error creating folder:', error);
						new Notice(t(this.settings.language, 'failedToCreateFolder'));
					}
				}
			}
		}

		// Create new file (empty, header will be added when first task is inserted)
		try {
			const newFile = await this.app.vault.create(filePath, '');
			return newFile;
		} catch (error) {
			console.error('Error creating monthly note:', error);
			new Notice(t(this.settings.language, 'failedToCreateNote'));
			return null;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		
		// Migrate old tasksFolderPath to new fields if needed
		if (this.settings.tasksFolderPath && !this.settings.createTaskFolderPath && !this.settings.calendarFolderPath) {
			this.settings.createTaskFolderPath = this.settings.tasksFolderPath;
			this.settings.calendarFolderPath = this.settings.tasksFolderPath;
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		// Note: View registration should only happen in onload()
		// If calendar is enabled/disabled, user needs to reload the plugin
	}

	async openCalendarView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType('task-calendar-view');

		if (leaves.length > 0) {
			// If calendar is already open, just reveal it
			leaf = leaves[0];
		} else {
			// Create a new leaf (tab) for the calendar
			leaf = workspace.getLeaf(true); // true = split, creates new tab
			await leaf.setViewState({ type: 'task-calendar-view', active: true });
		}

		if (leaf) {
			workspace.setActiveLeaf(leaf);
		}
	}
}

class CreateTaskButtonSettingTab extends PluginSettingTab {
	plugin: CreateTaskButtonPlugin;

	constructor(app: App, plugin: CreateTaskButtonPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Create Task Button Settings'});

		const lang = this.plugin.settings.language;
		
		new Setting(containerEl)
			.setName(t(lang, 'createTaskFolderPath'))
			.setDesc(t(lang, 'createTaskFolderPathDesc'))
			.addText(text => text
				.setPlaceholder('Tasks')
				.setValue(this.plugin.settings.createTaskFolderPath || this.plugin.settings.tasksFolderPath || '')
				.onChange(async (value) => {
					this.plugin.settings.createTaskFolderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(lang, 'filenameFormat'))
			.setDesc(t(lang, 'filenameFormatDesc'))
			.addText(text => text
				.setPlaceholder('YYYY-MM')
				.setValue(this.plugin.settings.filenameFormat || 'YYYY-MM')
				.onChange(async (value) => {
					this.plugin.settings.filenameFormat = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(lang, 'calendarTasksFolderPath'))
			.setDesc(t(lang, 'calendarTasksFolderPathDesc'))
			.addText(text => text
				.setPlaceholder('Tasks')
				.setValue(this.plugin.settings.calendarFolderPath || this.plugin.settings.tasksFolderPath || '')
				.onChange(async (value) => {
					this.plugin.settings.calendarFolderPath = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(lang, 'autoOpenCalendar'))
			.setDesc(t(lang, 'autoOpenCalendarDesc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoOpenCalendar)
				.onChange(async (value) => {
					this.plugin.settings.autoOpenCalendar = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName(t(lang, 'language'))
			.setDesc(t(lang, 'languageDesc'))
			.addDropdown(dropdown => dropdown
				.addOption('en', 'English')
				.addOption('ru', 'Русский')
				.setValue(this.plugin.settings.language || 'en')
				.onChange(async (value: 'ru' | 'en') => {
					this.plugin.settings.language = value;
					await this.plugin.saveSettings();
					this.display(); // Refresh translations
				}));
				
		containerEl.createEl('h3', { text: t(lang, 'taskColors') });
		
		this.addColorSetting(containerEl, 'incompleteTaskColor', 'incompleteTaskColorDesc', 'incompleteTaskColor');
		this.addColorSetting(containerEl, 'completedTaskColor', 'completedTaskColorDesc', 'completedTaskColor');
		this.addColorSetting(containerEl, 'overdueTaskColor', 'overdueTaskColorDesc', 'overdueTaskColor');
	}

	private addColorSetting(
		containerEl: HTMLElement, 
		nameKey: string, 
		descKey: string, 
		settingKey: 'incompleteTaskColor' | 'completedTaskColor' | 'overdueTaskColor'
	) {
		const lang = this.plugin.settings.language;
		
		const setting = new Setting(containerEl)
			.setName(t(lang, nameKey))
			.setDesc(t(lang, descKey));
			
		// Color picker
		setting.addColorPicker(color => color
			.setValue(this.plugin.settings[settingKey] || '')
			.onChange(async (value) => {
				this.plugin.settings[settingKey] = value;
				await this.plugin.saveSettings();
			}));
			
		// Add reset button
		setting.addExtraButton(button => button
			.setIcon('reset')
			.setTooltip(t(lang, 'resetToDefault'))
			.onClick(async () => {
				this.plugin.settings[settingKey] = '';
				await this.plugin.saveSettings();
				this.display(); 
			}));
			
		// Add presets
		const presetsContainer = containerEl.createDiv('task-calendar-color-presets');
		presetsContainer.style.display = 'flex';
		presetsContainer.style.gap = '8px';
		presetsContainer.style.marginBottom = '18px';
		// Align with setting control (right side usually, but setting puts desc on left and control on right)
		// We'll put it below the description
		
		presetsContainer.createSpan({ text: t(lang, 'presets') + ': ', cls: 'task-calendar-presets-label' });
		
		COLOR_PRESETS.forEach(preset => {
			const presetBtn = presetsContainer.createEl('div', {
				cls: 'task-calendar-color-preset',
				attr: {
					'aria-label': preset.name,
					'title': preset.name
				}
			});
			presetBtn.style.backgroundColor = preset.value;
			presetBtn.style.width = '20px';
			presetBtn.style.height = '20px';
			presetBtn.style.borderRadius = '50%';
			presetBtn.style.cursor = 'pointer';
			presetBtn.style.border = '1px solid var(--background-modifier-border)';
			
			presetBtn.addEventListener('click', async () => {
				this.plugin.settings[settingKey] = preset.value;
				await this.plugin.saveSettings();
				this.display();
			});
		});
	}
}

class TaskCalendarView extends ItemView {
	plugin: CreateTaskButtonPlugin;
	private tasks: Task[] = [];
	private currentDate: Date = new Date();
	private showCompletedTasks: boolean = true; // Will be loaded from settings
	private wheelHandler: ((e: WheelEvent) => void) | null = null;
	private swipeHandlers: {
		touchStart: ((e: TouchEvent) => void) | null;
		touchMove: ((e: TouchEvent) => void) | null;
		touchEnd: ((e: TouchEvent) => void) | null;
		touchCancel: ((e: TouchEvent) => void) | null;
		mouseDown: ((e: MouseEvent) => void) | null;
		mouseMove: ((e: MouseEvent) => void) | null;
		mouseUp: ((e: MouseEvent) => void) | null;
		mouseLeave: ((e: MouseEvent) => void) | null;
		gridContainer: HTMLElement | null;
	} = {
		touchStart: null,
		touchMove: null,
		touchEnd: null,
		touchCancel: null,
		mouseDown: null,
		mouseMove: null,
		mouseUp: null,
		mouseLeave: null,
		gridContainer: null
	};
	
	getLanguage(): 'ru' | 'en' {
		return this.plugin.settings.language || 'en';
	}
	
	getDayNames(): string[] {
		const lang = this.getLanguage();
		if (lang === 'ru') {
			return ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
		}
		return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	}
	
	getMonthNames(): string[] {
		const lang = this.getLanguage();
		if (lang === 'ru') {
			return ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
				'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
		}
		return ['January', 'February', 'March', 'April', 'May', 'June',
			'July', 'August', 'September', 'October', 'November', 'December'];
	}
	
	t(key: string): string {
		const lang = this.getLanguage();
		return t(lang, key);
	}

	constructor(leaf: WorkspaceLeaf, plugin: CreateTaskButtonPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return 'task-calendar-view';
	}

	getDisplayText(): string {
		return 'Task Calendar';
	}

	getIcon(): string {
		return 'calendar';
	}

	async onOpen() {
		// Load filter state from settings
		this.showCompletedTasks = this.plugin.settings.showCompletedTasks !== undefined 
			? this.plugin.settings.showCompletedTasks 
			: true;
		
		await this.loadTasks();
		await this.render();
		
		// Listen for file changes to refresh calendar
		this.registerEvent(
			this.app.vault.on('modify', async (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					await this.loadTasks();
					const container = this.containerEl.children[1] as HTMLElement;
					if (container) {
						await this.renderCalendar(container);
					}
				}
			})
		);
	}

	async onClose() {
		// Cleanup wheel handler
		if (this.wheelHandler) {
			const container = this.containerEl.children[1] as HTMLElement;
			if (container) {
				container.removeEventListener('wheel', this.wheelHandler);
			}
			this.wheelHandler = null;
		}
		
		// Cleanup swipe handlers
		if (this.swipeHandlers.gridContainer) {
			if (this.swipeHandlers.touchStart) {
				this.swipeHandlers.gridContainer.removeEventListener('touchstart', this.swipeHandlers.touchStart);
			}
			if (this.swipeHandlers.touchMove) {
				this.swipeHandlers.gridContainer.removeEventListener('touchmove', this.swipeHandlers.touchMove);
			}
			if (this.swipeHandlers.touchEnd) {
				this.swipeHandlers.gridContainer.removeEventListener('touchend', this.swipeHandlers.touchEnd);
			}
			if (this.swipeHandlers.touchCancel) {
				this.swipeHandlers.gridContainer.removeEventListener('touchcancel', this.swipeHandlers.touchCancel);
			}
			if (this.swipeHandlers.mouseDown) {
				this.swipeHandlers.gridContainer.removeEventListener('mousedown', this.swipeHandlers.mouseDown);
			}
			if (this.swipeHandlers.mouseMove) {
				document.removeEventListener('mousemove', this.swipeHandlers.mouseMove);
			}
			if (this.swipeHandlers.mouseUp) {
				document.removeEventListener('mouseup', this.swipeHandlers.mouseUp);
			}
			if (this.swipeHandlers.mouseLeave) {
				this.swipeHandlers.gridContainer.removeEventListener('mouseleave', this.swipeHandlers.mouseLeave);
			}
		}
		this.swipeHandlers = {
			touchStart: null,
			touchMove: null,
			touchEnd: null,
			touchCancel: null,
			mouseDown: null,
			mouseMove: null,
			mouseUp: null,
			mouseLeave: null,
			gridContainer: null
		};
	}

	async loadTasks() {
		this.tasks = [];
		
		// Try to use Tasks plugin API first, fallback to manual parsing
		const plugins = (this.app as any).plugins;
		const tasksPlugin = plugins?.plugins?.['obsidian-tasks-plugin'];
		
		if (tasksPlugin?.apiV1) {
			console.log('[Task Calendar] Using Tasks plugin API to find all tasks');
			await this.loadTasksFromAPI(tasksPlugin.apiV1);
		} else {
			console.log('[Task Calendar] Tasks plugin API not available, using manual parsing');
			await this.loadTasksManually();
		}
		
		// Filter tasks to show only those with calendar emoji 📅
		this.tasks = this.tasks.filter(task => {
			return task.text.includes('📅');
		});
		
		// Deduplicate tasks by file path and line number
		const taskMap = new Map<string, Task>();
		for (const task of this.tasks) {
			const key = `${task.file.path}:${task.line}`;
			if (!taskMap.has(key)) {
				taskMap.set(key, task);
			}
		}
		this.tasks = Array.from(taskMap.values());
	}
	
	private async loadTasksFromAPI(tasksApi: any) {
		try {
			// Try different API methods - Tasks plugin API structure may vary
			let allTasks: any[] = [];
			
			if (typeof tasksApi.getTasks === 'function') {
				allTasks = tasksApi.getTasks();
			} else if (typeof tasksApi.getAllTasks === 'function') {
				allTasks = tasksApi.getAllTasks();
			} else if (tasksApi.cache && Array.isArray(tasksApi.cache)) {
				allTasks = tasksApi.cache;
			} else {
				console.warn('[Task Calendar] Tasks API structure not recognized, falling back to manual parsing');
				await this.loadTasksManually();
				return;
			}
			
			console.log(`[Task Calendar] Tasks API: found ${allTasks.length} tasks`);
			
			// Get folder path from settings and normalize it
			// Use calendarFolderPath, fallback to tasksFolderPath for backward compatibility
			const folderPath = (this.plugin.settings.calendarFolderPath || this.plugin.settings.tasksFolderPath || '').trim();
			const normalizedFolderPath = folderPath ? folderPath.replace(/^\/+|\/+$/g, '') : '';
			
			for (const task of allTasks) {
				// Get the file from the task - try different property names
				const taskPath = task.path || task.file?.path || task.filePath || '';
				if (!taskPath) {
					continue;
				}
				
				const file = this.app.vault.getAbstractFileByPath(taskPath);
				if (!(file instanceof TFile)) {
					continue;
				}
				
				// Filter by folder if specified
				if (normalizedFolderPath) {
					const normalizedFilePath = file.path.replace(/^\/+|\/+$/g, '');
					if (!normalizedFilePath.startsWith(normalizedFolderPath)) {
						continue;
					}
				}
				
				// Extract date from task - try different property names
				let taskDate: Date | null = null;
				
				// Try due date first (various property names)
				const dueDate = task.dueDate || task.due || task.dueDateString;
				const startDate = task.startDate || task.start || task.startDateString;
				const scheduledDate = task.scheduledDate || task.scheduled || task.scheduledDateString;
				
				if (dueDate) {
					taskDate = new Date(dueDate);
				} else if (startDate) {
					taskDate = new Date(startDate);
				} else if (scheduledDate) {
					taskDate = new Date(scheduledDate);
				}
				
				// If no date found, try extracting from description
				if (!taskDate || isNaN(taskDate.getTime())) {
					const taskText = task.description || task.originalMarkdown || task.text || task.content || '';
					taskDate = this.extractDateFromText(taskText);
				}
				
				// Fallback to file date if filename matches configured pattern
				if (!taskDate || isNaN(taskDate.getTime())) {
					const fileName = file.basename;
					const format = this.plugin.settings.filenameFormat || 'YYYY-MM';
					const parsedDate = moment(fileName, format, true);
					
					if (parsedDate.isValid()) {
						taskDate = parsedDate.toDate();
					} else if (/^\d{4}-\d{2}$/.test(fileName)) {
						// Fallback to legacy YYYY-MM if current format doesn't match
						const [year, month] = fileName.split('-').map(Number);
						taskDate = new Date(year, month - 1, 1);
					} else {
						// Use today as fallback
						taskDate = new Date();
						taskDate.setHours(0, 0, 0, 0);
					}
				}
				
				// Ensure date is valid
				if (!taskDate || isNaN(taskDate.getTime())) {
					taskDate = new Date();
					taskDate.setHours(0, 0, 0, 0);
				}
				
				// Normalize date to start of day
				taskDate.setHours(0, 0, 0, 0);
				
				// Get task text and completion status
				let taskText = task.description || task.originalMarkdown || task.text || task.content || '';
				
				// Try to get full task content including nested lines from file
				const taskLineNumber = task.lineNumber || task.line || 0;
				try {
					const fileContent = await this.app.vault.read(file);
					const lines = fileContent.split('\n');
					
					if (taskLineNumber < lines.length) {
						const taskLine = lines[taskLineNumber];
						const taskMatch = taskLine.match(/^([\s\t]*)[-*]\s+\[([ xX✓✅])\]/);
						if (taskMatch) {
							const taskIndent = taskMatch[1];
							const taskIndentLength = taskIndent.length;
							
							// Collect nested lines (lines with greater indent that follow the task)
							const nestedLines: string[] = [];
							for (let j = taskLineNumber + 1; j < lines.length; j++) {
								const nextLine = lines[j];
								// Skip empty lines
								if (nextLine.trim() === '') {
									nestedLines.push(nextLine);
									continue;
								}
								
								// Check if line has greater indent than the task
								const nextLineIndent = nextLine.match(/^[\s\t]*/)?.[0] || '';
								if (nextLineIndent.length > taskIndentLength) {
									// This is a nested line
									nestedLines.push(nextLine);
								} else {
									// This is not a nested line, stop collecting
									break;
								}
							}
							
							// Combine task text with nested lines
							if (nestedLines.length > 0) {
								// Extract task text from the line
								const taskTextMatch = taskLine.match(/^[\s\t]*[-*]\s+\[([ xX✓✅])\]\s+(.+)$/);
								if (taskTextMatch) {
									taskText = taskTextMatch[2] + '\n' + nestedLines.join('\n');
								}
							}
						}
					}
				} catch (e) {
					// If reading file fails, use task text from API
					console.warn('[Task Calendar] Failed to read file for nested lines:', e);
				}
				
				// Only add tasks that contain calendar emoji 📅
				if (!taskText.includes('📅')) {
					continue;
				}
				
				const taskStatus = task.status || task.completion || '';
				const isCompleted = taskStatus !== ' ' && taskStatus !== '' && taskStatus !== 'todo';
				
				this.tasks.push({
					text: taskText,
					date: taskDate,
					file: file,
					line: taskLineNumber,
					isCompleted: isCompleted
				});
			}
			
			console.log(`[Task Calendar] Loaded ${this.tasks.length} tasks from API`);
		} catch (error) {
			console.error('[Task Calendar] Error loading tasks from API:', error);
			// Fallback to manual parsing
			await this.loadTasksManually();
		}
	}

	private extractDateFromText(text: string): Date | null {
		// Try various date formats from Tasks plugin
		// Format: 📅 YYYY-MM-DD or due::YYYY-MM-DD or start::YYYY-MM-DD or scheduled::YYYY-MM-DD
		const patterns = [
			/(?:📅|due::|due:|start::|start:|scheduled::|scheduled:)\s*(\d{4}-\d{2}-\d{2})/i,
			/(\d{4}-\d{2}-\d{2})/, // Any YYYY-MM-DD format
			/(\d{1,2}\/\d{1,2}\/\d{4})/, // DD/MM/YYYY
			/(\d{1,2}\.\d{1,2}\.\d{4})/, // DD.MM.YYYY
		];
		
		for (const pattern of patterns) {
			const match = text.match(pattern);
			if (match) {
				const dateStr = match[1];
				const date = new Date(dateStr);
				if (!isNaN(date.getTime())) {
					date.setHours(0, 0, 0, 0);
					return date;
				}
			}
		}
		
		return null;
	}

	private async loadTasksManually() {
		const files = this.app.vault.getMarkdownFiles();
		
		// Get folder path from settings and normalize it
		// Use calendarFolderPath, fallback to tasksFolderPath for backward compatibility
		const folderPath = (this.plugin.settings.calendarFolderPath || this.plugin.settings.tasksFolderPath || '').trim();
		const normalizedFolderPath = folderPath ? folderPath.replace(/^\/+|\/+$/g, '') : '';
		
		console.log(`[Task Calendar] Manual parsing: checking ${files.length} files, folder path: "${normalizedFolderPath || 'all files'}"`);
		
		let filesChecked = 0;
		let tasksFound = 0;
		
		for (const file of files) {
			// Filter by folder if specified
			if (normalizedFolderPath) {
				const normalizedFilePath = file.path.replace(/^\/+|\/+$/g, '');
				if (!normalizedFilePath.startsWith(normalizedFolderPath)) {
					continue;
				}
			}

			filesChecked++;
			
			try {
				const content = await this.app.vault.read(file);
				const lines = content.split('\n');
				
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					// Match task pattern: - [ ] or - [x] or - [X] or * [ ] or ✅
					const taskMatch = line.match(/^([\s\t]*)[-*]\s+\[([ xX✓✅])\]\s+(.+)$/);
					if (taskMatch) {
						const taskIndent = taskMatch[1];
						const isCompleted = taskMatch[2] !== ' ' && taskMatch[2] !== '';
						const taskText = taskMatch[3];
						
						// Only process tasks that contain calendar emoji 📅
						if (!taskText.includes('📅')) {
							continue;
						}
						
						// Collect nested lines (lines with greater indent that follow the task)
						const nestedLines: string[] = [];
						const taskIndentLength = taskIndent.length;
						
						for (let j = i + 1; j < lines.length; j++) {
							const nextLine = lines[j];
							// Skip empty lines
							if (nextLine.trim() === '') {
								nestedLines.push(nextLine);
								continue;
							}
							
							// Check if line has greater indent than the task
							const nextLineIndent = nextLine.match(/^[\s\t]*/)?.[0] || '';
							if (nextLineIndent.length > taskIndentLength) {
								// This is a nested line
								nestedLines.push(nextLine);
							} else {
								// This is not a nested line, stop collecting
								break;
							}
						}
						
						// Combine task text with nested lines
						const fullTaskText = taskText + (nestedLines.length > 0 ? '\n' + nestedLines.join('\n') : '');
						
						let taskDate: Date | null = null;
						
						// Try to extract date from task text
						taskDate = this.extractDateFromText(fullTaskText);
						
						if (!taskDate) {
							// Use file date if filename matches configured pattern
							const fileName = file.basename;
							const format = this.plugin.settings.filenameFormat || 'YYYY-MM';
							const parsedDate = moment(fileName, format, true);
							
							if (parsedDate.isValid()) {
								taskDate = parsedDate.toDate();
							} else if (/^\d{4}-\d{2}$/.test(fileName)) {
								// Fallback to legacy YYYY-MM if current format doesn't match
								const [year, month] = fileName.split('-').map(Number);
								taskDate = new Date(year, month - 1, 1);
							} else {
								// Use today as fallback
								taskDate = new Date();
								taskDate.setHours(0, 0, 0, 0);
							}
						}
						
						// Ensure date is valid
						if (!taskDate || isNaN(taskDate.getTime())) {
							taskDate = new Date();
							taskDate.setHours(0, 0, 0, 0);
						}
						
						// Normalize date to start of day
						taskDate.setHours(0, 0, 0, 0);
						
						this.tasks.push({
							text: fullTaskText,
							date: taskDate,
							file: file,
							line: i,
							isCompleted: isCompleted
						});
						
						tasksFound++;
					}
				}
			} catch (error) {
				console.error(`[Task Calendar] Error reading file ${file.path}:`, error);
			}
		}
		
		console.log(`[Task Calendar] Manual parsing: checked ${filesChecked} files, found ${tasksFound} tasks, total loaded: ${this.tasks.length}`);
	}


	async render() {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('task-calendar-container');
		
		// Add floating action button for creating tasks (add to root container for proper positioning)
		this.addFloatingActionButton(container);

		// Header with navigation
		const header = container.createDiv('task-calendar-header');
		// Group navigation buttons and month/year together
		const navGroup = header.createDiv('task-calendar-nav-group');
		const prevBtn = navGroup.createEl('button', { text: '←', cls: 'task-calendar-nav-btn' });
		const monthYear = navGroup.createEl('button', { cls: 'task-calendar-month-year task-calendar-month-year-btn' });
		const nextBtn = navGroup.createEl('button', { text: '→', cls: 'task-calendar-nav-btn' });
		
		// Add filter button for completed tasks
		const lang = this.getLanguage();
		const filterBtn = header.createEl('button', { 
			cls: 'task-calendar-filter-btn',
			title: this.showCompletedTasks 
				? t(lang, 'hideCompletedTasks')
				: t(lang, 'showCompletedTasks')
		});
		
		// Set icon based on filter state
		// When showing completed tasks: show filter icon
		// When hiding completed tasks: show crossed-out filter icon
		filterBtn.innerHTML = this.showCompletedTasks 
			? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>'
			: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon><line x1="2" y1="21" x2="22" y2="3"></line></svg>';
		
		if (!this.showCompletedTasks) {
			filterBtn.addClass('task-calendar-filter-btn-hidden');
		}
		
		filterBtn.addEventListener('click', async () => {
			this.showCompletedTasks = !this.showCompletedTasks;
			
			// Save filter state to settings
			this.plugin.settings.showCompletedTasks = this.showCompletedTasks;
			await this.plugin.saveSettings();
			
			// Update icon
			filterBtn.innerHTML = this.showCompletedTasks 
				? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>'
				: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon><line x1="2" y1="21" x2="22" y2="3"></line></svg>';
			const lang = this.getLanguage();
			filterBtn.title = this.showCompletedTasks 
				? t(lang, 'hideCompletedTasks')
				: t(lang, 'showCompletedTasks');
			if (this.showCompletedTasks) {
				filterBtn.removeClass('task-calendar-filter-btn-hidden');
			} else {
				filterBtn.addClass('task-calendar-filter-btn-hidden');
			}
			void this.renderCalendar(container as HTMLElement);
		});
		
		this.updateMonthYear(monthYear);
		
		// Make month/year button clickable to jump to current date
		monthYear.addEventListener('click', () => {
			this.currentDate = new Date();
			this.updateMonthYear(monthYear);
			void this.renderCalendar(container as HTMLElement);
		});
		
		prevBtn.addEventListener('click', () => {
			this.currentDate.setMonth(this.currentDate.getMonth() - 1);
			this.updateMonthYear(monthYear);
			void this.renderCalendar(container as HTMLElement);
		});
		
		nextBtn.addEventListener('click', () => {
			this.currentDate.setMonth(this.currentDate.getMonth() + 1);
			this.updateMonthYear(monthYear);
			void this.renderCalendar(container as HTMLElement);
		});

		// Render calendar
		const calendarContainer = container.createDiv('task-calendar-grid-container');
		await this.renderCalendar(container as HTMLElement);
		
		// Add swipe handlers for mobile navigation
		this.addSwipeHandlers(container, monthYear);
		
		// Add wheel scroll handler for desktop navigation
		this.addWheelHandler(container, monthYear);
	}
	
	private addFloatingActionButton(container: HTMLElement) {
		// Remove existing button if any
		const existingBtn = container.querySelector('.task-calendar-fab');
		if (existingBtn) {
			existingBtn.remove();
		}
		
		const fab = container.createDiv('task-calendar-fab');
		fab.createEl('span', { text: '+', cls: 'task-calendar-fab-icon' });
		
		const lang = this.getLanguage();
		fab.title = t(lang, 'createTask');
		
		fab.addEventListener('click', async () => {
			await this.plugin.createTask();
			// Reload tasks and refresh view after creating task
			await this.loadTasks();
			this.renderCalendar(container);
		});
	}
	
	private addWheelHandler(container: HTMLElement, monthYear: HTMLElement) {
		// Remove old handler if exists
		if (this.wheelHandler) {
			container.removeEventListener('wheel', this.wheelHandler);
			this.wheelHandler = null;
		}
		
		let lastScrollTime = 0;
		let accumulatedDelta = 0;
		let resetTimeout: number | null = null;
		const SCROLL_THRESHOLD = 100; // Minimum accumulated delta to trigger
		const MIN_SCROLL_INTERVAL = 300; // Minimum time between scroll actions (ms)
		
		const handleWheel = (e: WheelEvent) => {
			
			// Check if scrolling over calendar grid (not header or other elements)
			const target = e.target as HTMLElement;
			if (target && !target.closest('.task-calendar-grid-container') && !target.closest('.task-calendar-grid')) {
				return;
			}
			
			// Prevent default scrolling behavior
			e.preventDefault();
			e.stopPropagation();
			
			// Clear reset timeout
			if (resetTimeout) {
				clearTimeout(resetTimeout);
				resetTimeout = null;
			}
			
			const now = Date.now();
			const timeSinceLastScroll = now - lastScrollTime;
			
			// Accumulate scroll delta
			accumulatedDelta += e.deltaY;
			
			// Check if enough time has passed and enough delta accumulated
			if (timeSinceLastScroll >= MIN_SCROLL_INTERVAL && Math.abs(accumulatedDelta) >= SCROLL_THRESHOLD) {
				// Determine scroll direction based on accumulated delta
				const direction = accumulatedDelta > 0 ? 1 : -1;
				
				// Reset accumulated delta
				accumulatedDelta = 0;
				lastScrollTime = now;
				
				// Perform scroll action
				if (direction > 0) {
					// Scroll down - next month
					this.currentDate.setMonth(this.currentDate.getMonth() + 1);
					this.updateMonthYear(monthYear);
					void this.renderCalendar(container);
				} else {
					// Scroll up - previous month
					this.currentDate.setMonth(this.currentDate.getMonth() - 1);
					this.updateMonthYear(monthYear);
					void this.renderCalendar(container);
				}
			}
			
			// Reset accumulated delta if no scroll for a while
			resetTimeout = window.setTimeout(() => {
				accumulatedDelta = 0;
			}, 300);
		};
		
		this.wheelHandler = handleWheel;
		container.addEventListener('wheel', handleWheel, { passive: false });
	}
	
	private async handleSwipe(direction: number) {
		// direction: 1 for next month (swipe left), -1 for previous month (swipe right)
		const container = this.containerEl.querySelector('.task-calendar-grid-container') as HTMLElement;
		if (!container) return;
		
		const containerWidth = container.clientWidth || window.innerWidth;
		
		// Animate out fully
		container.style.transition = 'transform 0.2s ease-out';
		container.style.transform = `translateX(${direction === 1 ? -containerWidth : containerWidth}px)`;
		
		await new Promise(resolve => setTimeout(resolve, 200));
		
		// Update date
		this.currentDate.setMonth(this.currentDate.getMonth() + direction);
		
		// Update month/year header
		const monthYear = this.containerEl.querySelector('.task-calendar-month-year') as HTMLElement;
		if (monthYear) {
			this.updateMonthYear(monthYear);
		}
		
		// Prepare for animate in
		container.style.transition = 'none';
		container.style.transform = `translateX(${direction === 1 ? containerWidth : -containerWidth}px)`;
		container.style.opacity = '0';
		
		// Render new calendar
		await this.renderCalendar(this.containerEl.children[1] as HTMLElement);
		
		container.style.opacity = '1';
		
		// Animate in
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				container.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
				container.style.transform = 'translateX(0)';
			});
		});
	}

	private addSwipeHandlers(container: HTMLElement, monthYear: HTMLElement) {
		// Cleanup old handlers if they exist
		if (this.swipeHandlers.gridContainer) {
			if (this.swipeHandlers.touchStart) {
				this.swipeHandlers.gridContainer.removeEventListener('touchstart', this.swipeHandlers.touchStart);
			}
			if (this.swipeHandlers.touchMove) {
				this.swipeHandlers.gridContainer.removeEventListener('touchmove', this.swipeHandlers.touchMove);
			}
			if (this.swipeHandlers.touchEnd) {
				this.swipeHandlers.gridContainer.removeEventListener('touchend', this.swipeHandlers.touchEnd);
			}
			if (this.swipeHandlers.touchCancel) {
				this.swipeHandlers.gridContainer.removeEventListener('touchcancel', this.swipeHandlers.touchCancel);
			}
		}
		
		let swipeStartX = 0;
		let swipeStartY = 0;
		let swipeStartTime = 0;
		let isSwiping = false;
		let touchIdentifier: number | null = null;
		
		// Get the grid container element
		const gridContainer = container.querySelector('.task-calendar-grid-container') as HTMLElement;
		if (!gridContainer) {
			console.warn('[Task Calendar] Grid container not found for swipe handlers');
			return;
		}
		
		// Set CSS to block browser gestures on grid container
		gridContainer.style.touchAction = 'pan-y';
		gridContainer.style.userSelect = 'none'; // Prevent text selection during drag
		
		// Common function to check if target should be ignored
		const shouldIgnoreTarget = (target: HTMLElement | null): boolean => {
			if (!target) return true;
			// Allow swipes on cells, but ignore FAB and nav buttons
			return !!(
				target.closest('.task-calendar-fab') ||
				target.closest('.task-calendar-nav-btn')
			);
		};
		
		// Common function to get client coordinates from event
		const getClientX = (e: TouchEvent): number => {
			if (e.touches.length > 0) {
				return e.touches[0].clientX;
			}
			return 0;
		};
		
		const getClientY = (e: TouchEvent): number => {
			if (e.touches.length > 0) {
				return e.touches[0].clientY;
			}
			return 0;
		};
		
		// Common function to handle swipe start
		const handleSwipeStartCommon = (clientX: number, clientY: number, target: HTMLElement) => {
			if (shouldIgnoreTarget(target)) {
				return false;
			}
			
			if (!gridContainer.contains(target)) {
				return false;
			}
			
			swipeStartX = clientX;
			swipeStartY = clientY;
			swipeStartTime = Date.now();
			isSwiping = false;
			return true;
		};
		
		// Common function to handle swipe move
		const handleSwipeMoveCommon = (clientX: number, clientY: number) => {
			if (swipeStartX === 0) return;
			
			const deltaX = clientX - swipeStartX;
			const deltaY = clientY - swipeStartY;
			const absDeltaX = Math.abs(deltaX);
			const absDeltaY = Math.abs(deltaY);
			
			if (absDeltaX > 5 || isSwiping) {
				if (absDeltaX > absDeltaY || isSwiping) {
					isSwiping = true;
					
					// Move content with finger
					gridContainer.style.transition = 'none';
					gridContainer.style.transform = `translateX(${deltaX}px)`;
					
					return true;
				}
			}
			return false;
		};
		
		// Common function to handle swipe end
		const handleSwipeEndCommon = (clientX: number, clientY: number) => {
			if (swipeStartX === 0) {
				resetSwipe();
				return;
			}
			
			if (!isSwiping || swipeStartX === 0) {
				resetSwipe();
				return;
			}
			
			const deltaX = clientX - swipeStartX;
			const absDeltaX = Math.abs(deltaX);
			const absDeltaY = Math.abs(clientY - swipeStartY);
			const deltaTime = Date.now() - swipeStartTime;
			const velocity = absDeltaX / deltaTime;
			
			if ((absDeltaX > 20 || velocity > 0.15) && deltaTime < 600 && absDeltaY < 100) {
				const direction = deltaX < 0 ? 1 : -1; // 1: next month (swipe left), -1: prev month (swipe right)
				
				this.handleSwipe(direction);
			} else {
				resetSwipe();
			}
			
			swipeStartX = 0;
			isSwiping = false;
			touchIdentifier = null;
		};
		
		// Function to reset swipe state
		const resetSwipe = () => {
			if (gridContainer) {
				gridContainer.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
				gridContainer.style.transform = 'translateX(0)';
				setTimeout(() => {
					if (gridContainer) {
						gridContainer.style.transition = '';
					}
				}, 300);
			}
			swipeStartX = 0;
			swipeStartY = 0;
			isSwiping = false;
			touchIdentifier = null;
		};
		
		// Touch event handlers
		const handleTouchStart = (e: TouchEvent) => {
			if (e.touches.length === 0) return;
			
			const target = e.target as HTMLElement;
			const touch = e.touches[0];
			
			if (shouldIgnoreTarget(target)) {
				return;
			}
			
			// Check if touch is on a cell with tasks - if so, don't block immediately
			// Let the cell's touch handler process it first, we'll handle swipes in move/end
			const cell = target.closest('.task-calendar-cell') as HTMLElement | null;
			if (cell && cell.style.cursor === 'pointer') {
				// It's a cell with tasks - don't block, just track for potential swipe
				if (handleSwipeStartCommon(touch.clientX, touch.clientY, target)) {
					touchIdentifier = touch.identifier;
				}
				return; // Don't prevent default, let cell handler work
			}
			
			// For other areas (empty space, headers), block immediately
			e.preventDefault();
			e.stopPropagation();
			e.stopImmediatePropagation();
			
			if (handleSwipeStartCommon(touch.clientX, touch.clientY, target)) {
				touchIdentifier = touch.identifier;
			}
		};
		
		const handleTouchMove = (e: TouchEvent) => {
			if (touchIdentifier === null || swipeStartX === 0) return;
			
			const touch = Array.from(e.touches).find(t => t.identifier === touchIdentifier);
			if (!touch) return;
			
			const target = e.target as HTMLElement;
			if (target && target.closest('.task-calendar-fab')) {
				return;
			}
			
			// Check if this is a horizontal swipe
			const deltaX = Math.abs(touch.clientX - swipeStartX);
			const deltaY = Math.abs(touch.clientY - swipeStartY);
			
			// Only block and handle if it's clearly a horizontal swipe
			if (deltaX > 10 && deltaX > deltaY) {
				if (handleSwipeMoveCommon(touch.clientX, touch.clientY)) {
					e.preventDefault();
					e.stopPropagation();
					e.stopImmediatePropagation();
				}
			}
		};
		
		const handleTouchEnd = (e: TouchEvent) => {
			const target = e.target as HTMLElement;
			if (target && target.closest('.task-calendar-fab')) {
				resetSwipe();
				return;
			}
			
			if (touchIdentifier === null || swipeStartX === 0) {
				resetSwipe();
				return;
			}
			
			const touch = Array.from(e.changedTouches).find(t => t.identifier === touchIdentifier);
			if (!touch) {
				resetSwipe();
				return;
			}
			
			// Check if this was a swipe or a tap
			const deltaX = Math.abs(touch.clientX - swipeStartX);
			const deltaY = Math.abs(touch.clientY - swipeStartY);
			const deltaTime = Date.now() - swipeStartTime;
			
			// Only process as swipe if it's clearly a horizontal swipe
			// If it's a small movement, it's likely a tap - let the cell handler process it
			if (deltaX > 30 || (deltaX > 15 && deltaX > deltaY && isSwiping)) {
				handleSwipeEndCommon(touch.clientX, touch.clientY);
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
			} else {
				// It was a tap, not a swipe - reset and let cell handler work
				resetSwipe();
			}
		};
		
		const handleTouchCancel = (e: TouchEvent) => {
			const target = e.target as HTMLElement;
			if (target && target.closest('.task-calendar-fab')) {
				resetSwipe();
				return;
			}
			
			if (isSwiping || touchIdentifier !== null) {
				e.preventDefault();
				e.stopPropagation();
				e.stopImmediatePropagation();
			}
			resetSwipe();
		};
		
		// Save handlers for cleanup
		this.swipeHandlers.touchStart = handleTouchStart;
		this.swipeHandlers.touchMove = handleTouchMove;
		this.swipeHandlers.touchEnd = handleTouchEnd;
		this.swipeHandlers.touchCancel = handleTouchCancel;
		this.swipeHandlers.gridContainer = gridContainer;
		
		// Register touch handlers on gridContainer with capture: true to intercept before Obsidian
		gridContainer.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
		gridContainer.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
		gridContainer.addEventListener('touchend', handleTouchEnd, { passive: false, capture: true });
		gridContainer.addEventListener('touchcancel', handleTouchCancel, { passive: false, capture: true });
	}

	private updateMonthYear(element: HTMLElement) {
		const monthNames = this.getMonthNames();
		const month = monthNames[this.currentDate.getMonth()];
		const year = this.currentDate.getFullYear();
		element.textContent = `${month} ${year}`;
		
		// Check if current month matches displayed month
		const today = new Date();
		const isCurrentMonth = this.currentDate.getMonth() === today.getMonth() && 
		                       this.currentDate.getFullYear() === today.getFullYear();
		
		if (isCurrentMonth) {
			element.addClass('task-calendar-month-year-current');
		} else {
			element.removeClass('task-calendar-month-year-current');
		}
	}
	
	private async renderCalendar(container: HTMLElement) {
		// Remove list container if exists
		const listContainer = container.querySelector('.task-list-container');
		if (listContainer) {
			listContainer.remove();
		}
		
		let calendarContainer = container.querySelector('.task-calendar-grid-container') as HTMLElement;
		if (!calendarContainer) {
			// If container doesn't exist, create it
			calendarContainer = container.createDiv('task-calendar-grid-container');
		}
		
		calendarContainer.empty();
		
		// Show message if no tasks
		if (this.tasks.length === 0) {
			const message = calendarContainer.createDiv('task-calendar-empty-message');
			message.innerHTML = `
				<h3>${this.t('noTasks')}</h3>
				<p>${this.t('onlyCalendarTasks')}</p>
				<p>${this.t('checkConsole')}</p>
			`;
			return;
		}

		// Day headers - start with Monday
		const dayHeaders = calendarContainer.createDiv('task-calendar-day-headers');
		const dayNames = this.getDayNames();
		dayNames.forEach(day => {
			dayHeaders.createDiv('task-calendar-day-header').textContent = day;
		});

		// Calendar grid
		const grid = calendarContainer.createDiv('task-calendar-grid');
		
		const year = this.currentDate.getFullYear();
		const month = this.currentDate.getMonth();
		const firstDay = new Date(year, month, 1);
		const lastDay = new Date(year, month + 1, 0);
		const startDate = new Date(firstDay);
		// Start week from Monday (0 = Sunday, 1 = Monday, etc.)
		// Adjust: if day is 0 (Sunday), make it 7, then subtract 1 to get Monday
		const firstDayOfWeek = firstDay.getDay();
		const daysToSubtract = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
		startDate.setDate(startDate.getDate() - daysToSubtract);

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		for (let i = 0; i < 42; i++) {
			const cellDate = new Date(startDate);
			cellDate.setDate(startDate.getDate() + i);
			
			const cell = grid.createDiv('task-calendar-cell');
			
			if (cellDate.getMonth() !== month) {
				cell.addClass('task-calendar-cell-other-month');
			}
			
			if (cellDate.getTime() === today.getTime()) {
				cell.addClass('task-calendar-cell-today');
			}

			// Add tasks for this date
			let dayTasks = this.getTasksForDate(cellDate);

			// If this is today, include overdue tasks
			if (cellDate.getTime() === today.getTime()) {
				const overdueTasks = this.getOverdueTasks();
				dayTasks = [...overdueTasks, ...dayTasks];
			}
			
			// Apply filter for completed tasks
			if (!this.showCompletedTasks) {
				dayTasks = dayTasks.filter(task => !task.isCompleted);
			}
			
			// Sort tasks: incomplete first, then completed
			const sortedDayTasks = [...dayTasks].sort((a, b) => {
				if (a.isCompleted === b.isCompleted) return 0;
				return a.isCompleted ? 1 : -1;
			});
			
			const dayNumber = cell.createDiv('task-calendar-day-number');
			const dayNumberText = cellDate.getDate().toString();
			const dateSpan = dayNumber.createSpan();
			dateSpan.textContent = dayNumberText;
			
			// Add task count next to date number if there are tasks
			if (sortedDayTasks.length > 0) {
				const taskCountSpan = dayNumber.createSpan('task-calendar-day-task-count');
				taskCountSpan.textContent = ` +${sortedDayTasks.length}`;
			}
			
			const tasksContainer = cell.createDiv('task-calendar-tasks');
			
			// Show up to 4 tasks to fit better without scroll
			const maxTasks = 4;
			for (const task of sortedDayTasks.slice(0, maxTasks)) {
				const taskEl = tasksContainer.createDiv('task-calendar-task');
				
				// Apply custom colors
				if (task.isCompleted) {
					taskEl.classList.add('task-calendar-task-completed');
					if (this.plugin.settings.completedTaskColor) {
						taskEl.style.backgroundColor = this.plugin.settings.completedTaskColor;
						taskEl.style.color = getContrastYIQ(this.plugin.settings.completedTaskColor);
					}
				} else {
					if (this.plugin.settings.incompleteTaskColor) {
						taskEl.style.backgroundColor = this.plugin.settings.incompleteTaskColor;
						taskEl.style.color = getContrastYIQ(this.plugin.settings.incompleteTaskColor);
					}
				}
				
				// Check if task is overdue (incomplete and date before today)
				if (!task.isCompleted && task.date) {
					const taskDate = new Date(task.date);
					taskDate.setHours(0, 0, 0, 0);
					// Using the same 'today' variable defined earlier in renderCalendar
					if (taskDate.getTime() < today.getTime()) {
						taskEl.classList.add('task-calendar-task-overdue');
						// Overdue class has !important in CSS for background-color, so it should override inline style
						// unless we use setProperty with priority
						if (this.plugin.settings.overdueTaskColor) {
							taskEl.style.setProperty('background-color', this.plugin.settings.overdueTaskColor, 'important');
							taskEl.style.setProperty('color', getContrastYIQ(this.plugin.settings.overdueTaskColor), 'important');
							taskEl.style.setProperty('border-color', 'rgba(0,0,0,0.2)', 'important');
						}
					}
				}

				// Get only first line (without nested content)
				const firstLine = task.text.split('\n')[0];
				
				// Clean task text from date markers and markdown syntax
				let displayText = firstLine
					.replace(/📅\s*\d{4}-\d{2}-\d{2}/g, '')
					.replace(/due::\s*\d{4}-\d{2}-\d{2}/gi, '')
					.replace(/\d{4}-\d{2}-\d{2}/g, '')
					// Remove markdown links [text](url) -> text
					.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
					// Remove markdown images ![alt](url) -> alt
					.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1')
					// Remove markdown bold **text** or __text__ -> text
					.replace(/\*\*([^*]+)\*\*/g, '$1')
					.replace(/__([^_]+)__/g, '$1')
					// Remove markdown italic *text* or _text_ -> text
					.replace(/\*([^*]+)\*/g, '$1')
					.replace(/_([^_]+)_/g, '$1')
					// Remove markdown code `code` -> code
					.replace(/`([^`]+)`/g, '$1')
					// Remove markdown strikethrough ~~text~~ -> text
					.replace(/~~([^~]+)~~/g, '$1')
					// Remove markdown headers # -> empty
					.replace(/^#+\s+/gm, '')
					// Remove markdown list markers - * + -> empty
					.replace(/^[\s]*[-*+]\s+/gm, '')
					// Remove extra whitespace
					.replace(/\s+/g, ' ')
					.trim();
				
				if (!displayText) {
					displayText = this.t('task');
				}
				
				// Truncate text for display
				const truncatedText = displayText.length > 30 
					? displayText.substring(0, 30) + '...' 
					: displayText;
				
				// Show only plain text (no markdown rendering)
				taskEl.textContent = truncatedText;
				
				taskEl.title = task.text; // Show full text on hover
			}
			
			// Make cell clickable to show all tasks for this date
			// Click works on entire cell including the "+number" area
			if (sortedDayTasks.length > 0) {
				cell.style.cursor = 'pointer';
				
				// Add click handler for desktop
				cell.addEventListener('click', () => {
					new TasksForDateModal(this.app, this, cellDate, sortedDayTasks).open();
				});
				
				// Add touch handler for mobile
				let touchStartTime = 0;
				let touchStartX = 0;
				let touchStartY = 0;
				
				cell.addEventListener('touchstart', (e: TouchEvent) => {
					if (e.touches.length > 0) {
						touchStartTime = Date.now();
						touchStartX = e.touches[0].clientX;
						touchStartY = e.touches[0].clientY;
					}
				}, { passive: true });
				
				cell.addEventListener('touchend', (e: TouchEvent) => {
					if (e.changedTouches.length > 0) {
						const touchEndTime = Date.now();
						const touchEndX = e.changedTouches[0].clientX;
						const touchEndY = e.changedTouches[0].clientY;
						const deltaX = Math.abs(touchEndX - touchStartX);
						const deltaY = Math.abs(touchEndY - touchStartY);
						const deltaTime = touchEndTime - touchStartTime;
						
						// If it's a quick tap (not a swipe), open the modal
						// Check if it's a horizontal swipe - if deltaX is large, it's a swipe, don't open modal
						if (deltaTime < 300 && deltaX < 10 && deltaY < 10) {
							// It's a tap, open modal
							e.preventDefault();
							e.stopPropagation();
							e.stopImmediatePropagation();
							new TasksForDateModal(this.app, this, cellDate, sortedDayTasks).open();
						} else if (deltaX > 30 || (deltaX > deltaY && deltaX > 15)) {
							// It's a horizontal swipe - let the swipe handler process it
							// Don't prevent default or stop propagation
						}
					}
				}, { passive: false });
			} else {
				// No tasks - set cursor to default
				cell.style.cursor = 'default';
			}
		}
	}

	private getTasksForDate(date: Date): Task[] {
		const dateStr = date.toDateString();
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		
		// Normalize input date for comparison
		const checkDate = new Date(date);
		checkDate.setHours(0, 0, 0, 0);
		const isPastDate = checkDate.getTime() < today.getTime();
		
		return this.tasks.filter(task => {
			if (!task.date) return false;
			if (task.date.toDateString() !== dateStr) return false;
			
			// If viewing a past date, hide incomplete tasks (they are moved to Today as overdue)
			if (isPastDate && !task.isCompleted) {
				return false;
			}
			
			return true;
		});
	}

	private getOverdueTasks(): Task[] {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		
		return this.tasks.filter(task => {
			if (!task.date) return false;
			// Check if date is before today
			if (task.date >= today) return false;
			// Check if task is not completed
			return !task.isCompleted;
		});
	}
	
	getTasksForDatePublic(date: Date): Task[] {
		return this.getTasksForDate(date);
	}

	async openTaskFile(task: Task) {
		const leaf = this.app.workspace.getLeaf();
		await leaf.openFile(task.file);
		
		// Try to scroll to the task line
		const view = leaf.view;
		if (view instanceof MarkdownView) {
			const editor = view.editor;
			editor.setCursor(task.line, 0);
		}
	}
	
	async toggleTaskCompletion(task: Task): Promise<boolean> {
		try {
			// Access Tasks plugin API
			const plugins = (this.app as any).plugins;
			const tasksPlugin = plugins?.plugins?.['obsidian-tasks-plugin'];
			
			if (!tasksPlugin?.apiV1) {
				console.warn('[Task Calendar] Tasks plugin API not available, using direct editing');
				return await this.toggleTaskCompletionDirect(task);
			}
			
			const tasksApi = tasksPlugin.apiV1;
			console.log('[Task Calendar] Attempting to toggle task via Tasks API:', task.file.path, task.line);
			
			// Method 1: Use executeToggleTaskDoneCommand (recommended method from Tasks API)
			// This method was introduced in Tasks 7.2.0
			if (typeof tasksApi.executeToggleTaskDoneCommand === 'function') {
				try {
					// Read the file to get the current task line
					const content = await this.app.vault.read(task.file);
					const lines = content.split('\n');
					
					if (task.line >= lines.length) {
						console.error(`[Task Calendar] Line ${task.line} is out of bounds for file ${task.file.path}`);
						return await this.toggleTaskCompletionDirect(task);
					}
					
					const taskLine = lines[task.line];
					
					// Call executeToggleTaskDoneCommand with the task line and file path
					const newTaskLine = tasksApi.executeToggleTaskDoneCommand(taskLine, task.file.path);
					
					// Update the line in the file
					lines[task.line] = newTaskLine;
					
					// Write the updated content back to the file
					await this.app.vault.modify(task.file, lines.join('\n'));
					
					// Update task completion status based on the new line
					// Check if task is completed: [x], [X], [✓], [✅] means completed, [ ] means incomplete
					const taskMatch = newTaskLine.match(/^[\s\t]*[-*]\s+\[([ xX✓✅])\]/);
					if (taskMatch) {
						const status = taskMatch[1];
						task.isCompleted = status !== ' ' && status !== '';
					} else {
						// If pattern doesn't match, toggle the status
						task.isCompleted = !task.isCompleted;
					}
					
					console.log('[Task Calendar] Successfully toggled via executeToggleTaskDoneCommand');
					return true;
				} catch (e) {
					console.warn('[Task Calendar] Error using executeToggleTaskDoneCommand:', e);
					// Fall through to other methods
				}
			}
			
			// Method 2: Try using Tasks API's toggleTask method directly if available
			if (typeof tasksApi.toggleTask === 'function') {
				try {
					// Get all tasks from API to find the task
					let allTasks: any[] = [];
					if (typeof tasksApi.getTasks === 'function') {
						allTasks = tasksApi.getTasks();
					} else if (typeof tasksApi.getAllTasks === 'function') {
						allTasks = tasksApi.getAllTasks();
					} else if (tasksApi.cache && Array.isArray(tasksApi.cache)) {
						allTasks = tasksApi.cache;
					}
					
					// Find the task in Tasks API by file path and line number
					const apiTask = allTasks.find((t: any) => {
						const taskPath = t.path || t.file?.path || t.filePath || '';
						const taskLine = t.lineNumber || t.line || 0;
						return taskPath === task.file.path && taskLine === task.line;
					});
					
					if (apiTask) {
						console.log('[Task Calendar] Found task in API, using toggleTask method');
						tasksApi.toggleTask(apiTask);
						// Wait a bit for the API to update the file
						await new Promise(resolve => setTimeout(resolve, 100));
						task.isCompleted = !task.isCompleted;
						return true;
					}
				} catch (e) {
					console.warn('[Task Calendar] Error using toggleTask method:', e);
				}
			}
			
			// Method 3: Get all tasks from API and try task-level methods
			let allTasks: any[] = [];
			if (typeof tasksApi.getTasks === 'function') {
				allTasks = tasksApi.getTasks();
			} else if (typeof tasksApi.getAllTasks === 'function') {
				allTasks = tasksApi.getAllTasks();
			} else if (tasksApi.cache && Array.isArray(tasksApi.cache)) {
				allTasks = tasksApi.cache;
			} else {
				console.warn('[Task Calendar] Cannot get tasks from API, trying commands');
				// Try commands instead
				return await this.toggleTaskViaCommand(task);
			}
			
			// Find the task in Tasks API by file path and line number
			const apiTask = allTasks.find((t: any) => {
				const taskPath = t.path || t.file?.path || t.filePath || '';
				const taskLine = t.lineNumber || t.line || 0;
				return taskPath === task.file.path && taskLine === task.line;
			});
			
			if (!apiTask) {
				console.warn('[Task Calendar] Task not found in Tasks API, trying commands');
				return await this.toggleTaskViaCommand(task);
			}
			
			console.log('[Task Calendar] Found task in API, trying task-level methods');
			
			// Method 4: Try toggle() method on task object
			if (typeof apiTask.toggle === 'function') {
				try {
					apiTask.toggle();
					await new Promise(resolve => setTimeout(resolve, 100));
					task.isCompleted = !task.isCompleted;
					console.log('[Task Calendar] Successfully toggled via apiTask.toggle()');
					return true;
				} catch (e) {
					console.warn('[Task Calendar] Error using apiTask.toggle():', e);
				}
			}
			
			// Method 5: Try toggleDone() method
			if (typeof apiTask.toggleDone === 'function') {
				try {
					apiTask.toggleDone();
					await new Promise(resolve => setTimeout(resolve, 100));
					task.isCompleted = !task.isCompleted;
					console.log('[Task Calendar] Successfully toggled via apiTask.toggleDone()');
					return true;
				} catch (e) {
					console.warn('[Task Calendar] Error using apiTask.toggleDone():', e);
				}
			}
			
			// Method 6: Try setCompletionStatus() or similar
			if (typeof apiTask.setCompletionStatus === 'function') {
				try {
					apiTask.setCompletionStatus(!task.isCompleted);
					await new Promise(resolve => setTimeout(resolve, 100));
					task.isCompleted = !task.isCompleted;
					console.log('[Task Calendar] Successfully toggled via apiTask.setCompletionStatus()');
					return true;
				} catch (e) {
					console.warn('[Task Calendar] Error using apiTask.setCompletionStatus():', e);
				}
			}
			
			// Method 7: Try using Tasks plugin's commands
			console.log('[Task Calendar] Trying to toggle via commands');
			return await this.toggleTaskViaCommand(task);
			
		} catch (error) {
			console.error('[Task Calendar] Error toggling task completion via Tasks API:', error);
			// Fallback to direct editing
			return await this.toggleTaskCompletionDirect(task);
		}
	}
	
	private async toggleTaskViaCommand(task: Task): Promise<boolean> {
		try {
			const leaf = this.app.workspace.getLeaf();
			await leaf.openFile(task.file);
			
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				const editor = view.editor;
				editor.setCursor(task.line, 0);
				
				// Try different command IDs that Tasks plugin might use
				const commands = [
					'tasks:toggle-task',
					'tasks:toggle-done',
					'tasks:mark-task-complete',
					'tasks:mark-task-incomplete',
					'tasks-plugin:toggle-task',
					'tasks-plugin:toggle-done',
					'tasks-plugin:mark-task-complete',
					'tasks-plugin:mark-task-incomplete'
				];
				
				// Determine which command to use based on current status
				const targetCommands = task.isCompleted 
					? commands.filter(cmd => cmd.includes('incomplete') || cmd.includes('toggle'))
					: commands.filter(cmd => cmd.includes('complete') || cmd.includes('toggle'));
				
				// Try commands in order
				for (const commandId of targetCommands) {
					try {
						console.log('[Task Calendar] Trying command:', commandId);
						await (this.app as any).command.executeCommandById(commandId);
						await new Promise(resolve => setTimeout(resolve, 100));
						task.isCompleted = !task.isCompleted;
						console.log('[Task Calendar] Successfully toggled via command:', commandId);
						return true;
					} catch (e) {
						// Command doesn't exist, try next
						console.log('[Task Calendar] Command not found:', commandId);
						continue;
					}
				}
			}
		} catch (e) {
			console.warn('[Task Calendar] Failed to use Tasks plugin command:', e);
		}
		
		// If no command works, fallback to direct editing
		console.warn('[Task Calendar] No suitable Tasks command found, using direct file editing');
		return await this.toggleTaskCompletionDirect(task);
	}
	
	private async toggleTaskCompletionDirect(task: Task): Promise<boolean> {
		try {
			// Read file content
			const content = await this.app.vault.read(task.file);
			const lines = content.split('\n');
			
			if (task.line >= lines.length) {
				console.error(`[Task Calendar] Line ${task.line} is out of bounds for file ${task.file.path}`);
				return false;
			}
			
			const line = lines[task.line];
			// Match task pattern: - [ ] or - [x] or - [X] or * [ ] or * [x]
			const taskMatch = line.match(/^([\s\t]*[-*])\s+\[([ xX✓✅])\]\s+(.+)$/);
			
			if (!taskMatch) {
				console.error(`[Task Calendar] Line ${task.line} does not match task pattern: ${line}`);
				return false;
			}
			
			// Toggle completion status
			const indent = taskMatch[1];
			const currentStatus = taskMatch[2];
			const taskText = taskMatch[3];
			
			// Determine new status: if currently completed, make incomplete; otherwise make completed
			const newStatus = (currentStatus !== ' ' && currentStatus !== '') ? ' ' : 'x';
			
			// Replace the line
			lines[task.line] = `${indent} [${newStatus}] ${taskText}`;
			
			// Write updated content
			await this.app.vault.modify(task.file, lines.join('\n'));
			
			// Update task object
			task.isCompleted = newStatus !== ' ';
			
			return true;
		} catch (error) {
			console.error('[Task Calendar] Error toggling task completion:', error);
			new Notice(t(this.plugin.settings.language, 'failedToToggleTaskCompletion'));
			return false;
		}
	}
	
}

class TasksForDateModal extends Modal {
	view: TaskCalendarView;
	date: Date;
	tasks: Task[];
	private currentTaskIndex: number = 0;
	private swipeHandlers: {
		start: ((e: TouchEvent) => void) | null;
		move: ((e: TouchEvent) => void) | null;
		end: ((e: TouchEvent) => void) | null;
		cancel: ((e: TouchEvent) => void) | null;
		container: HTMLElement | null;
	} = {
		start: null,
		move: null,
		end: null,
		cancel: null,
		container: null
	};
	
	constructor(app: App, view: TaskCalendarView, date: Date, tasks: Task[]) {
		super(app);
		this.view = view;
		this.date = date;
		
		// Normalize date for comparison
		const targetDateStart = new Date(date);
		targetDateStart.setHours(0, 0, 0, 0);

		// Sort tasks: Overdue first, then Incomplete, then Completed
		this.tasks = [...tasks].sort((a, b) => {
			// Check overdue status
			const aDate = a.date ? new Date(a.date) : null;
			if (aDate) aDate.setHours(0,0,0,0);
			
			const bDate = b.date ? new Date(b.date) : null;
			if (bDate) bDate.setHours(0,0,0,0);
			
			const aIsOverdue = aDate && aDate < targetDateStart && !a.isCompleted;
			const bIsOverdue = bDate && bDate < targetDateStart && !b.isCompleted;
			
			if (aIsOverdue && !bIsOverdue) return -1;
			if (!aIsOverdue && bIsOverdue) return 1;

			if (a.isCompleted === b.isCompleted) return 0;
			return a.isCompleted ? 1 : -1;
		});
		this.currentTaskIndex = 0;
	}
	
	async onOpen() {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		contentEl.addClass('tasks-for-date-modal');
		// Add class to modal root for mobile styling
		if (modalEl) {
			modalEl.addClass('tasks-for-date-modal-root');
			// Hide default close button
			const closeButton = modalEl.querySelector('.modal-close-button');
			if (closeButton) {
				(closeButton as HTMLElement).style.display = 'none';
			}
		}
		
		const lang = this.view.getLanguage();
		const monthNames = this.view.getMonthNames();
		const dateStr = lang === 'ru'
			? `${this.date.getDate()} ${monthNames[this.date.getMonth()]} ${this.date.getFullYear()}`
			: `${monthNames[this.date.getMonth()]} ${this.date.getDate()}, ${this.date.getFullYear()}`;
		
		// Header
		const header = contentEl.createDiv('tasks-for-date-modal-header');
		const headerTitle = header.createEl('h2', { 
			text: `${this.view.t('tasksForDate')} ${dateStr}`,
			cls: 'tasks-for-date-modal-header-clickable'
		});
		
		// Make header clickable to open the monthly note file
		headerTitle.style.cursor = 'pointer';
		headerTitle.title = t(lang, 'openFileForThisDate');
		headerTitle.addEventListener('click', async () => {
			await this.openMonthlyNoteFile();
		});
		
		// Markdown content container
		const markdownContainer = contentEl.createDiv('tasks-for-date-modal-content');
		
		// Separate tasks
		const targetDateStart = new Date(this.date);
		targetDateStart.setHours(0, 0, 0, 0);
		
		const overdueTasks = this.tasks.filter(t => {
			if (!t.date) return false;
			const tDate = new Date(t.date);
			tDate.setHours(0,0,0,0);
			return tDate < targetDateStart && !t.isCompleted;
		});

		// Render Overdue Tasks
		if (overdueTasks.length > 0) {
			const overdueContainer = markdownContainer.createDiv('tasks-modal-overdue-section');
			// Add separator header
			overdueContainer.createEl('h3', { 
				text: this.view.t('overdue'),
				cls: 'tasks-modal-section-header'
			});
			
			// Try to use Tasks plugin to render tasks with query
			const plugins = (this.app as any).plugins;
			const tasksPlugin = plugins?.plugins?.['obsidian-tasks-plugin'];
			let overdueRendered = false;

			if (tasksPlugin?.apiV1) {
				try {
					const year = this.date.getFullYear();
					const month = String(this.date.getMonth() + 1).padStart(2, '0');
					const day = String(this.date.getDate()).padStart(2, '0');
					const dateQuery = `${year}-${month}-${day}`;

					const queryOverdue = `\`\`\`tasks
due before ${dateQuery}
not done
show tree
hide task count
sort by due
\`\`\``;

					await MarkdownRenderer.renderMarkdown(
						queryOverdue,
						overdueContainer,
						this.tasks[0]?.file.path || '',
						this.view.plugin
					);
					
					overdueRendered = true;
					
					// Check if Tasks plugin actually rendered tasks
					// Wait for Tasks plugin to process the query block
					await new Promise(resolve => setTimeout(resolve, 200));
					
					const taskBlocks = overdueContainer.querySelectorAll('.tasks-list-container, .task-list-view, .task-list-item');
					if (taskBlocks.length > 0) {
						if (tasksPlugin.apiV1 && typeof (tasksPlugin.apiV1 as any).renderTaskBlock === 'function') {
							for (const block of Array.from(taskBlocks)) {
								try {
									(tasksPlugin.apiV1 as any).renderTaskBlock(block as HTMLElement);
								} catch (e) {
									// Ignore errors
								}
							}
						}
					}
				} catch (e) {
					console.warn('[Task Calendar] Failed to use Tasks query renderer for overdue:', e);
					overdueRendered = false;
				}
			}

			if (!overdueRendered) {
				const markdown = await this.generateMarkdownForTasks(overdueTasks);
				await MarkdownRenderer.renderMarkdown(
					markdown,
					overdueContainer,
					overdueTasks[0]?.file.path || '',
					this.view.plugin
				);
			}
		}
		
		if (this.tasks.length === 0) {
			const emptyMessage = markdownContainer.createDiv('tasks-for-date-modal-empty');
			emptyMessage.textContent = this.view.t('noTasksForDate');
		} else {
			// Separate remaining tasks into incomplete (current) and completed
			const currentDayTasks = this.tasks.filter(t => !overdueTasks.includes(t));
			const incompleteTasks = currentDayTasks.filter(t => !t.isCompleted);
			const completedTasks = currentDayTasks.filter(t => t.isCompleted);

			// Try to use Tasks plugin to render tasks with query
			const plugins = (this.app as any).plugins;
			const tasksPlugin = plugins?.plugins?.['obsidian-tasks-plugin'];
			
			let tasksRendered = false;
			
			if (tasksPlugin?.apiV1) {
				// Use Tasks plugin to render tasks query
				try {
					// Build Tasks query for this date
					const year = this.date.getFullYear();
					const month = String(this.date.getMonth() + 1).padStart(2, '0');
					const day = String(this.date.getDate()).padStart(2, '0');
					const dateQuery = `${year}-${month}-${day}`;
					
					const todayContainer = markdownContainer.createDiv('tasks-modal-today-section');

					// Query for incomplete tasks (Current)
					if (incompleteTasks.length > 0) {
						// Add separator header for Current
						todayContainer.createEl('h3', { 
							text: this.view.t('current'),
							cls: 'tasks-modal-section-header'
						});

						const queryIncomplete = `\`\`\`tasks
due on ${dateQuery}
not done
show tree
hide task count
sort by due
\`\`\``;
						
						// Render markdown - Tasks plugin should automatically process the tasks block
						await MarkdownRenderer.renderMarkdown(
							queryIncomplete,
							todayContainer,
							this.tasks[0]?.file.path || '',
							this.view.plugin
						);
					}

					// Query for completed tasks (Completed)
					if (completedTasks.length > 0) {
						// Add separator header for Completed
						todayContainer.createEl('h3', { 
							text: this.view.t('completedSection'),
							cls: 'tasks-modal-section-header'
						});

						const queryCompleted = `\`\`\`tasks
due on ${dateQuery}
done
show tree
hide task count
sort by due
\`\`\``;

						await MarkdownRenderer.renderMarkdown(
							queryCompleted,
							todayContainer,
							this.tasks[0]?.file.path || '',
							this.view.plugin
						);
					}
					
					// Wait for Tasks plugin to process the query block
					await new Promise(resolve => setTimeout(resolve, 200));
					
					// Check if Tasks plugin actually rendered tasks
					const taskBlocks = todayContainer.querySelectorAll('.tasks-list-container, .task-list-view, .task-list-item');
					if (taskBlocks.length > 0) {
						tasksRendered = true;
						
						if (tasksPlugin.apiV1 && typeof (tasksPlugin.apiV1 as any).renderTaskBlock === 'function') {
							for (const block of Array.from(taskBlocks)) {
								try {
									(tasksPlugin.apiV1 as any).renderTaskBlock(block as HTMLElement);
								} catch (e) {
									// Ignore errors
								}
							}
						}
					}
				} catch (e) {
					console.warn('[Task Calendar] Failed to use Tasks query renderer:', e);
					tasksRendered = false;
				}
			}
			
			// Fallback: manual markdown rendering (only if Tasks plugin didn't render)
			if (!tasksRendered) {
				// Remove today container if it exists but failed
				const existingToday = markdownContainer.querySelector('.tasks-modal-today-section');
				if (existingToday) existingToday.remove();
				
				const todayContainer = markdownContainer.createDiv('tasks-modal-today-section');

				// Add incomplete tasks (Current)
				if (incompleteTasks.length > 0) {
					// Add separator header for Current
					todayContainer.createEl('h3', { 
						text: this.view.t('current'),
						cls: 'tasks-modal-section-header'
					});

					const markdown = await this.generateMarkdownForTasks(incompleteTasks);
					await MarkdownRenderer.renderMarkdown(
						markdown,
						todayContainer,
						incompleteTasks[0]?.file.path || '',
						this.view.plugin
					);
				}
				
				// Add completed tasks (Completed)
				if (completedTasks.length > 0) {
					// Add separator header for Completed
					todayContainer.createEl('h3', { 
						text: this.view.t('completedSection'),
						cls: 'tasks-modal-section-header'
					});

					const markdown = await this.generateMarkdownForTasks(completedTasks);
					await MarkdownRenderer.renderMarkdown(
						markdown,
						todayContainer,
						completedTasks[0]?.file.path || '',
						this.view.plugin
					);
				}
			}
			
			// After rendering, attach click handlers to checkboxes
			setTimeout(() => {
				this.attachCheckboxHandlers(markdownContainer);
				this.attachTaskClickHandlers(markdownContainer);
				this.attachTaskExtrasHandlers(markdownContainer);
			}, 300);
		}
		
		// Footer with close button
		const footer = contentEl.createDiv('tasks-for-date-modal-footer');
		const closeButton = footer.createEl('button', { 
			text: t(lang, 'close'),
			cls: 'tasks-for-date-modal-close-btn'
		});
		closeButton.addEventListener('click', () => {
			this.close();
		});
		
		// Add swipe handlers for date navigation
		// Attach to contentEl to handle swipes on the entire modal content
		this.addSwipeHandlers(contentEl);
	}
	
	private addSwipeHandlers(container: HTMLElement) {
		// Cleanup old handlers if they exist
		if (this.swipeHandlers.container) {
			if (this.swipeHandlers.start) {
				this.swipeHandlers.container.removeEventListener('touchstart', this.swipeHandlers.start);
			}
			if (this.swipeHandlers.move) {
				this.swipeHandlers.container.removeEventListener('touchmove', this.swipeHandlers.move);
			}
			if (this.swipeHandlers.end) {
				this.swipeHandlers.container.removeEventListener('touchend', this.swipeHandlers.end);
			}
			if (this.swipeHandlers.cancel) {
				this.swipeHandlers.container.removeEventListener('touchcancel', this.swipeHandlers.cancel);
			}
		}
		
		let swipeStartX = 0;
		let swipeStartY = 0;
		let swipeStartTime = 0;
		let isSwiping = false;
		let touchIdentifier: number | null = null;
		
		// Set CSS to allow touch gestures
		container.style.touchAction = 'pan-y';
		
		const handleSwipeStart = (e: TouchEvent) => {
			if (e.touches.length === 0) return;
			
			const target = e.target as HTMLElement;
			const touch = e.touches[0];
			
			// Don't handle swipe if touch is on interactive elements
			if (target && (
				target.closest('input[type="checkbox"]') ||
				target.closest('button') ||
				target.closest('a') ||
				target.closest('.task-extras') ||
				target.closest('.modal-close-button')
			)) {
				return;
			}
			
			// Initialize swipe tracking
			swipeStartX = touch.clientX;
			swipeStartY = touch.clientY;
			swipeStartTime = Date.now();
			isSwiping = false;
			touchIdentifier = touch.identifier;
		};
		
		const handleSwipeMove = (e: TouchEvent) => {
			const target = e.target as HTMLElement;
			if (target && (
				target.closest('input[type="checkbox"]') ||
				target.closest('button') ||
				target.closest('a') ||
				target.closest('.task-extras')
			)) {
				return;
			}
			
			// Find the touch with matching identifier
			if (touchIdentifier === null || swipeStartX === 0) return;
			
			const touch = Array.from(e.touches).find(t => t.identifier === touchIdentifier);
			if (!touch) return;
			
			const deltaX = touch.clientX - swipeStartX;
			const deltaY = touch.clientY - swipeStartY;
			const absDeltaX = Math.abs(deltaX);
			const absDeltaY = Math.abs(deltaY);
			
			// If we detect horizontal movement, start blocking default behavior
			if (absDeltaX > 5 || isSwiping) {
				if (absDeltaX > absDeltaY || isSwiping) {
					isSwiping = true;
					
					// Move content with finger
					container.style.transition = 'none';
					container.style.transform = `translateX(${deltaX}px)`;
					
					e.preventDefault();
					e.stopPropagation();
				}
			}
		};
		
		const handleSwipeEnd = (e: TouchEvent) => {
			const target = e.target as HTMLElement;
			if (target && (
				target.closest('input[type="checkbox"]') ||
				target.closest('button') ||
				target.closest('a') ||
				target.closest('.task-extras')
			)) {
				swipeStartX = 0;
				isSwiping = false;
				touchIdentifier = null;
				return;
			}
			
			// Find the touch with matching identifier
			if (touchIdentifier === null || swipeStartX === 0) {
				swipeStartX = 0;
				isSwiping = false;
				touchIdentifier = null;
				return;
			}
			
			const touch = Array.from(e.changedTouches).find(t => t.identifier === touchIdentifier);
			if (!touch) {
				swipeStartX = 0;
				isSwiping = false;
				touchIdentifier = null;
				return;
			}
			
			if (!isSwiping || swipeStartX === 0) {
				swipeStartX = 0;
				isSwiping = false;
				touchIdentifier = null;
				return;
			}
			
			const swipeEndX = touch.clientX;
			const swipeEndY = touch.clientY;
			const deltaX = swipeEndX - swipeStartX;
			const absDeltaX = Math.abs(deltaX);
			const absDeltaY = Math.abs(swipeEndY - swipeStartY);
			const deltaTime = Date.now() - swipeStartTime;
			const velocity = absDeltaX / deltaTime; // pixels per ms
			
			// Check if it's a valid swipe (horizontal movement > 20px OR velocity > 0.15, time < 600ms, vertical movement < 100px)
			if ((absDeltaX > 20 || velocity > 0.15) && deltaTime < 600 && absDeltaY < 100) {
				e.preventDefault();
				e.stopPropagation();
				
				const direction = deltaX < 0 ? 1 : -1; // 1: next (swipe left), -1: prev (swipe right)
				const containerWidth = container.clientWidth || window.innerWidth;
				
				// Animate out fully
				container.style.transition = 'transform 0.2s ease-out';
				container.style.transform = `translateX(${direction === 1 ? -containerWidth : containerWidth}px)`;
				
				setTimeout(async () => {
					// Update date
					const newDate = new Date(this.date);
					newDate.setDate(newDate.getDate() + direction);
					this.date = newDate;
					
					// Update tasks
					const rawTasks = this.view.getTasksForDatePublic(this.date);
					// Sort tasks: Incomplete first
					this.tasks = [...rawTasks].sort((a, b) => {
						if (a.isCompleted === b.isCompleted) return 0;
						return a.isCompleted ? 1 : -1;
					});
					
					// Prepare for animate in
					container.style.transition = 'none';
					container.style.transform = `translateX(${direction === 1 ? containerWidth : -containerWidth}px)`;
					container.style.opacity = '0';
					
					// Re-render content
					await this.onOpen();
					
					container.style.opacity = '1';
					
					// Animate in
					requestAnimationFrame(() => {
						requestAnimationFrame(() => {
							container.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
							container.style.transform = 'translateX(0)';
						});
					});
				}, 200);
			} else {
				// Snap back
				container.style.transition = 'transform 0.3s ease-out';
				container.style.transform = 'translateX(0)';
			}
			
			swipeStartX = 0;
			isSwiping = false;
			touchIdentifier = null;
		};
		
		const handleTouchCancel = (e: TouchEvent) => {
			// Snap back if cancelled
			if (isSwiping) {
				container.style.transition = 'transform 0.3s ease-out';
				container.style.transform = 'translateX(0)';
			}
			swipeStartX = 0;
			isSwiping = false;
			touchIdentifier = null;
		};
		
		// Save handlers for cleanup
		this.swipeHandlers.start = handleSwipeStart;
		this.swipeHandlers.move = handleSwipeMove;
		this.swipeHandlers.end = handleSwipeEnd;
		this.swipeHandlers.cancel = handleTouchCancel;
		this.swipeHandlers.container = container;
		
		// Register handlers
		container.addEventListener('touchstart', handleSwipeStart, { passive: false });
		container.addEventListener('touchmove', handleSwipeMove, { passive: false });
		container.addEventListener('touchend', handleSwipeEnd, { passive: false });
		container.addEventListener('touchcancel', handleTouchCancel, { passive: false });
	}
	
	private scrollToCurrentTask(container: HTMLElement) {
		// Find all task list items
		const listItems = container.querySelectorAll('ul > li, ol > li');
		
		if (listItems.length === 0 || this.currentTaskIndex >= listItems.length) {
			return;
		}
		
		const targetItem = listItems[this.currentTaskIndex] as HTMLElement;
		if (targetItem) {
			// Scroll the task into view
			targetItem.scrollIntoView({
				behavior: 'smooth',
				block: 'center'
			});
			
			// Highlight the current task briefly
			targetItem.style.transition = 'background-color 0.3s ease';
			targetItem.style.backgroundColor = 'var(--background-modifier-hover)';
			setTimeout(() => {
				targetItem.style.backgroundColor = '';
				setTimeout(() => {
					targetItem.style.transition = '';
				}, 300);
			}, 500);
		}
	}
	
	private attachCheckboxHandlers(markdownContainer: HTMLElement) {
		// Find only top-level task checkboxes (not in nested lists)
		// Get top-level list items (direct children of top-level ul/ol)
		const topLevelListItems = markdownContainer.querySelectorAll('ul > li, ol > li');
		let taskIndex = 0;
		
		topLevelListItems.forEach((listItem) => {
			// Find the task checkbox - the first checkbox that is in this list item
			// but NOT inside any nested ul/ol list
			// The key is: checkbox's closest ul/ol should be the same as listItem's parent ul/ol
			
			const parentList = listItem.closest('ul, ol');
			if (!parentList) return;
			
			// Get all checkboxes in this list item
			const allCheckboxes = Array.from(listItem.querySelectorAll('input[type="checkbox"]'));
			
			// Find the first checkbox whose closest ul/ol is the same as parentList
			// (meaning it's not in a nested list)
			let taskCheckbox: HTMLInputElement | null = null;
			
			for (const checkbox of allCheckboxes) {
				const checkboxEl = checkbox as HTMLInputElement;
				
				// Get the ul/ol that directly contains this checkbox
				const checkboxParentList = checkboxEl.closest('ul, ol');
				
				// Check if this checkbox is inside a nested list
				// A nested list would be: listItem contains a ul/ol, and checkbox is inside that ul/ol
				const nestedListsInItem = listItem.querySelectorAll('ul, ol');
				let isInNestedList = false;
				
				for (const nestedList of Array.from(nestedListsInItem)) {
					// If checkbox is inside this nested list, it's nested
					if (nestedList.contains(checkboxEl) && nestedList !== parentList) {
						isInNestedList = true;
						break;
					}
				}
				
				// If not in nested list, and checkbox's parent list is the same as listItem's parent list,
				// this is the task checkbox
				if (!isInNestedList && checkboxParentList === parentList) {
					taskCheckbox = checkboxEl;
					break;
				}
			}
			
			// Process the task checkbox if found
			if (taskCheckbox && taskIndex < this.tasks.length) {
				const task = this.tasks[taskIndex];
				
				// Set initial state
				taskCheckbox.checked = task.isCompleted;
				
				// Add click handler
				taskCheckbox.addEventListener('change', async (e) => {
					e.stopPropagation();
					e.preventDefault();
					
					// Prevent default behavior
					const wasChecked = taskCheckbox!.checked;
					taskCheckbox!.checked = task.isCompleted; // Revert to current state
					
					// Toggle task via Tasks API
					const success = await this.view.toggleTaskCompletion(task);
					
					if (success) {
						// Update checkbox state
						taskCheckbox!.checked = task.isCompleted;
						
						// Reload tasks and refresh calendar view
						await this.view.loadTasks();
						this.view.render();
						
						// Update tasks list from view's tasks filtered by date
						this.tasks = this.view.getTasksForDatePublic(this.date);
						
						// Re-sort and re-render modal content
						this.tasks = [...this.tasks].sort((a, b) => {
							if (a.isCompleted === b.isCompleted) return 0;
							return a.isCompleted ? 1 : -1;
						});
						this.onOpen();
					} else {
						// Revert checkbox if failed
						taskCheckbox!.checked = !wasChecked;
					}
				});
				
				taskIndex++;
			}
		});
	}
	
	private attachTaskClickHandlers(markdownContainer: HTMLElement) {
		// Task click handlers removed - tasks are no longer clickable to open files
	}
	
	private attachTaskExtrasHandlers(markdownContainer: HTMLElement) {
		// Use event delegation to handle clicks on buttons/links in .task-extras
		// This works even if buttons are added dynamically by Tasks plugin
		markdownContainer.addEventListener('click', (e) => {
			const target = e.target as HTMLElement;
			
			// Check if click is on a button or link inside .task-extras
			const taskExtrasElement = target.closest('.task-extras');
			if (taskExtrasElement) {
				// Check if the clicked element is a button or link
				if (target.tagName === 'BUTTON' || 
					target.tagName === 'A' || 
					target.closest('button') || 
					target.closest('a[role="button"]') ||
					target.closest('a')) {
					// Close the modal when clicking on any button/link in task-extras
					this.close();
				}
			}
		});
	}
	
	private async openMonthlyNoteFile() {
		try {
			// Get header/filename based on configured format
			const format = this.view.plugin.settings.filenameFormat || 'YYYY-MM';
			const dateHeader = moment(this.date).format(format);
			const fileName = `${dateHeader}.md`;
			
			// Use createTaskFolderPath, fallback to tasksFolderPath for backward compatibility
			const folderPathSetting = this.view.plugin.settings.createTaskFolderPath || this.view.plugin.settings.tasksFolderPath || '';
			
			// Build file path with folder if specified
			let filePath = fileName;
			if (folderPathSetting.trim()) {
				const folderPath = folderPathSetting.trim().replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes
				filePath = folderPath ? `${folderPath}/${fileName}` : fileName;
			}
			
			// Check if file exists
			let file = this.app.vault.getAbstractFileByPath(filePath);
			
			// If file doesn't exist, create it
			if (!(file instanceof TFile)) {
				// Create folder if it doesn't exist and path is specified
				if (folderPathSetting.trim()) {
					const folderPath = folderPathSetting.trim().replace(/^\/+|\/+$/g, '');
					if (folderPath) {
						const folder = this.app.vault.getAbstractFileByPath(folderPath);
						if (!folder) {
							try {
								await this.app.vault.createFolder(folderPath);
							} catch (error) {
								console.error('Error creating folder:', error);
							}
						}
					}
				}
				
				// Create new file
				try {
					file = await this.app.vault.create(filePath, '');
				} catch (error) {
					console.error('Error creating monthly note:', error);
					new Notice(t(this.view.plugin.settings.language, 'failedToCreateNote'));
					return;
				}
			}
			
			if (file instanceof TFile) {
				// Open the file
				const leaf = this.app.workspace.getLeaf();
				await leaf.openFile(file);
				
				// Close the modal
				this.close();
			}
		} catch (error) {
			console.error('Error opening monthly note file:', error);
			new Notice(t(this.view.plugin.settings.language, 'failedToOpenFile'));
		}
	}
	
	private async generateMarkdownForTasks(tasks: Task[]): Promise<string> {
		const markdownLines: string[] = [];
		
		for (const task of tasks) {
			try {
				const fileContent = await this.app.vault.read(task.file);
				const lines = fileContent.split('\n');
				
				if (task.line < lines.length) {
					const taskLine = lines[task.line];
					// Remove dates from the task line but keep the full markdown structure
					let cleanedTaskLine = taskLine
						.replace(/📅\s*\d{4}-\d{2}-\d{2}/g, '')
						.replace(/due::\s*\d{4}-\d{2}-\d{2}/gi, '')
						.replace(/start::\s*\d{4}-\d{2}-\d{2}/gi, '')
						.replace(/scheduled::\s*\d{4}-\d{2}-\d{2}/gi, '')
						.replace(/\s+\d{4}-\d{2}-\d{2}/g, '')
						.replace(/\s{2,}/g, ' ') // Replace multiple spaces with single space
						.trim();
					
					// Get nested lines from task.text (they already include proper formatting)
					const taskTextLines = task.text.split('\n');
					const nestedLines = taskTextLines.slice(1);
					
					// Add task line to markdown
					markdownLines.push(cleanedTaskLine);
					
					// Add nested lines
					if (nestedLines.length > 0) {
						markdownLines.push(...nestedLines);
					}
					
					// Add empty line between tasks
					markdownLines.push('');
				} else {
					throw new Error('Line out of bounds');
				}
			} catch (e) {
				// Fallback: construct markdown from task.text
				const taskTextLines = task.text.split('\n');
				const checkbox = task.isCompleted ? '[x]' : '[ ]';
				const firstLine = `- ${checkbox} ${taskTextLines[0]}`;
				const nestedLines = taskTextLines.slice(1);
				
				markdownLines.push(firstLine);
				if (nestedLines.length > 0) {
					markdownLines.push(...nestedLines);
				}
				markdownLines.push('');
			}
		}
		
		// Remove last empty line
		if (markdownLines.length > 0 && markdownLines[markdownLines.length - 1] === '') {
			markdownLines.pop();
		}
		
		return markdownLines.join('\n');
	}

	onClose() {
		const { contentEl } = this;
		
		// Cleanup swipe hazndlers
		if (this.swipeHandlers.container) {
			if (this.swipeHandlers.start) {
				this.swipeHandlers.container.removeEventListener('touchstart', this.swipeHandlers.start);
			}
			if (this.swipeHandlers.move) {
				this.swipeHandlers.container.removeEventListener('touchmove', this.swipeHandlers.move);
			}
			if (this.swipeHandlers.end) {
				this.swipeHandlers.container.removeEventListener('touchend', this.swipeHandlers.end);
			}
			if (this.swipeHandlers.cancel) {
				this.swipeHandlers.container.removeEventListener('touchcancel', this.swipeHandlers.cancel);
			}
		}
		this.swipeHandlers = {
			start: null,
			move: null,
			end: null,
			cancel: null,
			container: null
		};
		
		contentEl.empty();
	}
}
