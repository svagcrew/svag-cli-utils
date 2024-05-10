/* eslint-disable @typescript-eslint/no-var-requires */
import child_process from 'child_process'
import editJsonFile from 'edit-json-file'
import fg from 'fast-glob'
import fs from 'fs/promises'
import fsync from 'fs'
import yaml from 'js-yaml'
import jsonStableStringify from 'json-stable-stringify'
import _ from 'lodash'
import path from 'path'
import pc from 'picocolors'
import { register } from 'ts-node'
import { PackageJson } from 'type-fest'
import { hideBin } from 'yargs/helpers'
import yargs from 'yargs/yargs'
import z from 'zod'

register({
  compilerOptions: {
    module: 'NodeNext',
  },
})

export const isFileExists = async ({ filePath }: { filePath: string }) => {
  try {
    await fs.access(filePath)
    return { fileExists: true }
  } catch {
    return { fileExists: false }
  }
}

export const isFileExistsSync = ({ filePath }: { filePath: string }) => {
  return { fileExists: fsync.existsSync(filePath) }
}

export const isItDir = async ({ cwd }: { cwd: string }) => {
  try {
    const stat = await fs.stat(cwd)
    return { itIsDir: stat.isDirectory() }
  } catch {
    return { itIsDir: false }
  }
}

export const isDirExists = async ({ cwd }: { cwd: string }) => {
  try {
    await fs.access(cwd)
    return { dirExists: true }
  } catch (error) {
    return { dirExists: false }
  }
}

export const isDirEmpty = async ({ cwd }: { cwd: string }) => {
  const files = await fs.readdir(cwd)
  return { dirEmpty: !files.length }
}

export const getDirInfo = async ({ cwd }: { cwd: string }) => {
  const { dirExists } = await isDirExists({ cwd })
  if (!dirExists) {
    return { dirExists: false, dirEmpty: true }
  }
  const { dirEmpty } = await isDirEmpty({ cwd })
  return { dirExists: true, dirEmpty }
}

export const getPathInfo = async ({ cwd }: { cwd: string }) => {
  const result = {
    itIsDir: false,
    itIsFile: false,
    pathExists: false,
    fileExists: false,
    dirExists: false,
    dirEmpty: true,
  }
  try {
    const stat = await fs.stat(cwd)
    result.pathExists = true
    if (stat.isDirectory()) {
      result.itIsDir = true
      result.dirExists = true
      const { dirEmpty } = await isDirEmpty({ cwd })
      result.dirEmpty = dirEmpty
    } else {
      result.itIsFile = true
      result.fileExists = true
    }
    return result
  } catch {
    return {
      itIsDir: false,
      itIsFile: false,
      pathExists: false,
      fileExists: false,
      dirExists: false,
      dirEmpty: true,
    }
  }
}

export const createDir = async ({ cwd }: { cwd: string }) => {
  await fs.mkdir(cwd, { recursive: true })
}

export const createFile = async ({ cwd, content = '' }: { cwd: string; content?: string }) => {
  await createDir({ cwd: path.dirname(cwd) })
  await fs.writeFile(cwd, content)
}

export const getPathsByGlobs = async ({ globs, baseDir }: { globs: string[]; baseDir: string }) => {
  const filePaths = await fg(globs, {
    cwd: baseDir,
    onlyFiles: true,
    absolute: true,
  })
  return { filePaths }
}

export const getDataFromFile = async ({ filePath }: { filePath: string }) => {
  const ext = path.basename(filePath).split('.').pop()
  if (ext === 'js' || ext === 'ts' || ext === 'mjs') {
    try {
      return require(filePath).default
    } catch (error) {
      return await import(filePath).then((module) => module.default)
    }
  }
  if (ext === 'yml' || ext === 'yaml') {
    return yaml.load(await fs.readFile(filePath, 'utf8'))
  }
  if (ext === 'json') {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  }
  throw new Error(`Unsupported file extension: ${ext}`)
}

export const getDataFromFileSync = ({ filePath }: { filePath: string }) => {
  const ext = path.basename(filePath).split('.').pop()
  if (ext === 'js' || ext === 'ts' || ext === 'mjs') {
    try {
      return require(filePath).default
    } catch (error) {
      return require(filePath)
    }
  }
  if (ext === 'yml' || ext === 'yaml') {
    return yaml.load(fsync.readFileSync(filePath, 'utf8'))
  }
  if (ext === 'json') {
    return JSON.parse(fsync.readFileSync(filePath, 'utf8'))
  }
  throw new Error(`Unsupported file extension: ${ext}`)
}

export const stringsToLikeArrayString = (paths: string[]) => {
  return paths.map((path) => `"${path}"`).join(', ')
}

export const getPackageJsonPath = async ({ cwd }: { cwd: string }) => {
  let dirPath = path.resolve('/', cwd)
  for (let i = 0; i < 777; i++) {
    const maybePackageJsonGlobs = [`${dirPath}/package.json`]
    const maybePackageJsonPath = (
      await fg(maybePackageJsonGlobs, {
        onlyFiles: true,
        absolute: true,
      })
    )[0]
    if (maybePackageJsonPath) {
      return { packageJsonPath: maybePackageJsonPath, packageJsonDir: path.dirname(maybePackageJsonPath) }
    }
    const parentDirPath = path.resolve(dirPath, '..')
    if (dirPath === parentDirPath) {
      throw new Error('package.json not found')
    }
    dirPath = parentDirPath
  }
  throw new Error('package.json not found')
}

export const getPackageJson = async ({ cwd }: { cwd: string }) => {
  const { packageJsonPath, packageJsonDir } = await getPackageJsonPath({ cwd })
  const packageJsonData: PackageJson = await getDataFromFile({
    filePath: packageJsonPath,
  })
  return { packageJsonData, packageJsonPath, packageJsonDir }
}

export const jsonStringify = ({ data, order }: { data: any; order: string[] }) => {
  const stringifyedData = jsonStableStringify(data, {
    space: 2,
    cmp: (a, b) => {
      const aIndex = order.indexOf(a.key)
      const bIndex = order.indexOf(b.key)
      if (aIndex === -1 && bIndex === -1) {
        return a.key < b.key ? -1 : 1
      }
      if (aIndex === -1) {
        return 1
      }
      if (bIndex === -1) {
        return -1
      }
      return aIndex - bIndex
    },
  })
  return stringifyedData
}

export const setJsonDataItem = async ({ filePath, key, value }: { filePath: string; key: string; value: any }) => {
  const { fileExists } = await isFileExists({ filePath })
  if (!fileExists) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, '{}\n')
  }
  const file = editJsonFile(filePath)
  file.set(key, value)
  file.save()
}

export const setPackageJsonDataItem = async ({ cwd, key, value }: { cwd: string; key: string; value: any }) => {
  const { packageJsonPath } = await getPackageJsonPath({ cwd })
  const file = editJsonFile(packageJsonPath)
  file.set(key, value)
  file.save()
}

type LogMessage = string | any
const logColored = ({
  message,
  color,
}: {
  message: string | string[]
  color?: 'red' | 'blue' | 'green' | 'gray' | 'black' | null
}) => {
  const messages = Array.isArray(message) ? message : [message]
  const stringifyedMessages = messages.map((message) => {
    if (typeof message === 'string') {
      return message
    }
    return jsonStableStringify(message, {
      space: 2,
    })
  })

  if (!color) {
    // eslint-disable-next-line no-console
    console.log(stringifyedMessages.join('\n'))
    return
  }
  // eslint-disable-next-line no-console
  console.log(pc[color](stringifyedMessages.join('\n')))
}

const logMemory: Record<string, string[]> = {
  default: [],
}
export const logToMemeoryColored = ({
  message,
  color,
  memoryKey = 'default',
}: {
  message: LogMessage | LogMessage[]
  color?: 'red' | 'blue' | 'green' | 'gray' | 'black' | null
  memoryKey?: string
}) => {
  const messages = (Array.isArray(message) ? message : [message]).map((message) => {
    if (color) {
      return pc[color](message)
    }
    return message
  })
  logMemory[memoryKey] = [...logMemory[memoryKey], ...messages]
}

export const log = {
  it: logColored,
  normal: (...message: LogMessage[]) => logColored({ message }),
  red: (...message: LogMessage[]) => logColored({ message, color: 'red' }),
  blue: (...message: LogMessage[]) => logColored({ message, color: 'blue' }),
  green: (...message: LogMessage[]) => logColored({ message, color: 'green' }),
  gray: (...message: LogMessage[]) => logColored({ message, color: 'gray' }),
  black: (...message: LogMessage[]) => logColored({ message, color: 'black' }),
  // eslint-disable-next-line no-console
  error: console.error,
  // eslint-disable-next-line no-console
  info: console.info,
  toMemory: {
    it: logToMemeoryColored,
    normal: (...message: LogMessage[]) => logToMemeoryColored({ message }),
    red: (...message: LogMessage[]) => logToMemeoryColored({ message, color: 'red' }),
    blue: (...message: LogMessage[]) => logToMemeoryColored({ message, color: 'blue' }),
    green: (...message: LogMessage[]) => logToMemeoryColored({ message, color: 'green' }),
    gray: (...message: LogMessage[]) => logToMemeoryColored({ message, color: 'gray' }),
    black: (...message: LogMessage[]) => logToMemeoryColored({ message, color: 'black' }),
  },
  fromMemory: (memoryKey = 'default') => {
    for (const message of logMemory[memoryKey] || []) {
      // eslint-disable-next-line no-console
      console.log(message)
    }
  },
  isMemoryNotEmpty: (memoryKey = 'default') => {
    return !!(logMemory[memoryKey]?.length > 0)
  },
}

const normalizeData = <T>(data: T): T => {
  return data
  // const dataString = data.toString()
  // if (dataString.match(/^\n*$/)) {
  //   return ''
  // }
  // return dataString.replace(/\n{2,}/g, '\n')
}

export const exec = async ({ cwd, command }: { cwd: string; command: string }): Promise<string> => {
  return await new Promise((resolve, reject) => {
    child_process.exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        return reject(error)
      }
      if (stderr) {
        return reject(stderr)
      }
      return resolve(stdout)
    })
  })
}

export const spawn = async ({
  cwd,
  command,
  verbose = true,
  exitOnFailure = false,
  env = {},
}: {
  cwd: string
  command: string
  verbose?: boolean
  exitOnFailure?: boolean
  env?: Record<string, string>
}): Promise<string> => {
  return await new Promise((resolve, reject) => {
    // const { commandSelf, commandArgs } = (() => {
    //   // const [commandSelf, ...commandArgs] = command.split(' ')
    //   const commandParts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)
    //   if (!commandParts) {
    //     throw new Error('Invalid command')
    //   }
    //   return {
    //     commandSelf: commandParts[0],
    //     commandArgs: commandParts.slice(1),
    //   }
    // })()
    if (verbose) {
      log.blue(`$ cd ${cwd}`)
      log.blue(`$ ${command}`)
    }
    // const child = child_process.spawn(commandSelf, commandArgs, {
    const child = child_process.spawn(command, {
      shell: true,
      cwd,
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => {
      const normalizedData = normalizeData(data)
      if (!normalizedData) {
        return
      }
      stdout += normalizedData
      if (verbose) {
        process.stdout.write(normalizedData)
      }
    })
    child.stderr.on('data', (data) => {
      const normalizedData = normalizeData(data)
      if (!normalizedData) {
        return
      }
      stderr += normalizedData
      if (verbose) {
        process.stderr.write(normalizedData)
      }
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        if (exitOnFailure) {
          process.exit(code || 1)
        } else {
          reject(stderr)
        }
      }
    })
  })
}

export const getFlagAsString = <T extends string | null | undefined = null>({
  flags,
  keys,
  coalesce = undefined,
}: {
  flags: Record<string, any>
  keys: string[]
  coalesce?: T
}): T extends string ? string : T extends null ? null | string : undefined | string => {
  for (const key of keys) {
    if (typeof flags[key] === 'string') {
      return flags[key] as any
    }
  }
  return coalesce as any
}

export const getFlagAsBoolean = ({
  flags,
  keys,
  coalesce,
}: {
  flags: Record<string, any>
  keys: string[]
  coalesce: boolean
}): boolean => {
  for (const key of keys) {
    if (typeof flags[key] === 'boolean') {
      return flags[key]
    }
  }
  return coalesce
}

export const getFirstStringValue = (...values: any[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string') {
      return value
    }
  }
  return null
}

export const getCwdCommandArgsFlags = async () => {
  const argv = await yargs(hideBin(process.argv)).argv
  const command = argv._[0]?.toString() || 'h'
  const args = argv._.slice(1).map((arg) => arg.toString())
  const flags = _.omit(argv, ['_', '$0'])
  const cwd = process.cwd()
  const argsRawFull = process.argv
  // get all elements from argsRawFull, after element with value is equal to command
  const argr = argsRawFull.slice(argsRawFull.indexOf(command) + 1)
  return { cwd, command, args, flags, argr }
}

export const validateOrThrow = <T extends z.ZodSchema>(props: { zod: T; text: string; data: any }) => {
  try {
    return props.zod.parse(props.data) as z.infer<T>
  } catch (error) {
    log.red(props.text)
    throw error
  }
}

export const defineCliApp = (app: (props: Awaited<ReturnType<typeof getCwdCommandArgsFlags>>) => any) => {
  void (async () => {
    try {
      const props = await getCwdCommandArgsFlags()
      await app(props)
    } catch (error) {
      log.error(error)
      process.exit(1)
    } finally {
      if (log.isMemoryNotEmpty()) {
        log.black('\n=====Result=====')
        log.fromMemory()
      }
    }
  })()
}
