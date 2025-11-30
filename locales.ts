export type Language = 'ru' | 'en';

export interface Translations {
	[key: string]: string;
}

export const translations: Record<Language, Translations> = {
	ru: {

		'noTasks': 'Задачи не найдены',
		'onlyCalendarTasks': 'Отображаются только задачи с эмодзи 📅',
		'checkConsole': 'Проверьте консоль (F12) для отладочной информации',
		'tasks': 'задач',
		'completed': 'выполнено',
		'task': 'Задача',
		'more': 'еще',
		'tasksForDate': 'Задачи на',
		'noTasksForDate': 'На эту дату нет задач',
		'openTask': 'Открыть задачу',
		'completedTask': 'Выполнено',
		'markCompleted': 'Выполнено',
		'markIncomplete': 'Не выполнено',
		'overdue': 'Не выполнено',
		'current': 'Текущие',
		'completedSection': 'Завершенные',

		'tasksPluginNotFound': 'Плагин Tasks не найден',
		'failedToCreateOrAccessNote': 'Не удалось создать или получить доступ к заметке',
		'taskAddedSuccessfully': 'Задача успешно добавлена',
		'failedToCreateFolder': 'Не удалось создать папку. Проверьте путь в настройках.',
		'failedToCreateNote': 'Не удалось создать заметку. Проверьте путь к папке в настройках.',
		'failedToToggleTaskCompletion': 'Не удалось изменить статус задачи',
		'failedToOpenFile': 'Не удалось открыть файл',

		'createTask': 'Создать задачу',
		'createTaskInEditor': 'Создать задачу в редакторе',
		'openTaskCalendar': 'Открыть календарь задач',
		'close': 'Закрыть',
		'openFileForThisDate': 'Открыть файл с этой датой',
		'hideCompletedTasks': 'Скрыть выполненные задачи',
		'showCompletedTasks': 'Показать выполненные задачи',

		'createTaskFolderPath': 'Путь к папке для создания задач',
		'createTaskFolderPathDesc': 'Путь к папке, где будут создаваться новые файлы задач (например, "Tasks" или "Notes/Tasks"). Оставьте пустым, чтобы создавать файлы в корне хранилища.',
		'calendarTasksFolderPath': 'Путь к папке с задачами для календаря',
		'calendarTasksFolderPathDesc': 'Путь к папке, из которой будут загружаться задачи для отображения в календаре (например, "Tasks" или "Notes/Tasks"). Оставьте пустым, чтобы загружать из всех файлов.',
		'autoOpenCalendar': 'Автоматически открывать календарь при запуске',
		'autoOpenCalendarDesc': 'При открытии приложения автоматически открывать вкладку с календарем. Если вкладка уже открыта, переключиться на нее.',
		'language': 'Язык / Language',
		'languageDesc': 'Язык интерфейса / Interface language',
		'filenameFormat': 'Формат имени файла',
		'filenameFormatDesc': 'Формат имени файла для новых задач (например: YYYY-MM, YYYY-MM-DD). Используйте токены moment.js.',
		'taskColors': 'Цвета задач',
		'incompleteTaskColor': 'Цвет невыполненных задач',
		'incompleteTaskColorDesc': 'Цвет фона для невыполненных задач. Нажмите на цветовой круг или выберите пресет.',
		'completedTaskColor': 'Цвет выполненных задач',
		'completedTaskColorDesc': 'Цвет фона для выполненных задач. Нажмите на цветовой круг или выберите пресет.',
		'overdueTaskColor': 'Цвет просроченных задач',
		'overdueTaskColorDesc': 'Цвет фона для просроченных задач (невыполненные задачи из прошлых дат).',
		'resetToDefault': 'Сбросить',
		'presets': 'Пресеты'
	},
	en: {

		'noTasks': 'No tasks found',
		'onlyCalendarTasks': 'Only tasks with 📅 emoji are displayed',
		'checkConsole': 'Check console (F12) for debugging information',
		'tasks': 'tasks',
		'completed': 'completed',
		'task': 'Task',
		'more': 'more',
		'tasksForDate': 'Tasks for',
		'noTasksForDate': 'No tasks for this date',
		'openTask': 'Open task',
		'completedTask': 'Completed',
		'markCompleted': 'Completed',
		'markIncomplete': 'Incomplete',
		'overdue': 'Overdue',
		'current': 'Current',
		'completedSection': 'Completed',

		'tasksPluginNotFound': 'Tasks plugin not found',
		'failedToCreateOrAccessNote': 'Failed to create or access note',
		'taskAddedSuccessfully': 'Task added successfully',
		'failedToCreateFolder': 'Failed to create folder. Check the path in settings.',
		'failedToCreateNote': 'Failed to create note. Check the folder path in settings.',
		'failedToToggleTaskCompletion': 'Failed to toggle task completion',
		'failedToOpenFile': 'Failed to open file',

		'createTask': 'Create task',
		'createTaskInEditor': 'Create task in editor',
		'openTaskCalendar': 'Open task calendar',
		'close': 'Close',
		'openFileForThisDate': 'Open file for this date',
		'hideCompletedTasks': 'Hide completed tasks',
		'showCompletedTasks': 'Show completed tasks',

		'createTaskFolderPath': 'Create task folder path',
		'createTaskFolderPathDesc': 'Path to folder where new task files will be created (e.g., "Tasks" or "Notes/Tasks"). Leave empty to create files in vault root.',
		'calendarTasksFolderPath': 'Calendar tasks folder path',
		'calendarTasksFolderPathDesc': 'Path to folder from which tasks will be loaded for calendar view (e.g., "Tasks" or "Notes/Tasks"). Leave empty to load from all files.',
		'autoOpenCalendar': 'Auto-open calendar on startup',
		'autoOpenCalendarDesc': 'Automatically open calendar tab when the app starts. If the tab is already open, switch to it.',
		'language': 'Language / Язык',
		'languageDesc': 'Interface language / Язык интерфейса',
		'filenameFormat': 'Filename format',
		'filenameFormatDesc': 'Filename format for new tasks (e.g., YYYY-MM, YYYY-MM-DD). Use moment.js tokens.',
		'taskColors': 'Task Colors',
		'incompleteTaskColor': 'Incomplete task color',
		'incompleteTaskColorDesc': 'Background color for incomplete tasks. Click the color circle or choose a preset.',
		'completedTaskColor': 'Completed task color',
		'completedTaskColorDesc': 'Background color for completed tasks. Click the color circle or choose a preset.',
		'overdueTaskColor': 'Overdue task color',
		'overdueTaskColorDesc': 'Background color for overdue tasks (incomplete tasks from past dates).',
		'resetToDefault': 'Reset',
		'presets': 'Presets'
	}
};

export function t(lang: Language, key: string): string {
	return translations[lang]?.[key] || translations.en[key] || key;
}
